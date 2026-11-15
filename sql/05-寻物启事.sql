-- ============================================================================
-- 05 · 寻物启事（寻物 / 招领）
-- ----------------------------------------------------------------------------
-- 为什么需要这段 SQL：
--   实测（2026-11-15）：全站没有任何一条「今天就能写」的通道——
--     · wall 表匿名 INSERT     → 401 permission denied
--     · wall_candidates 匿名写 → 401 permission denied
--     · storage 匿名上传       → 400 RLS 拒绝
--     · fn_wall_post 的 tag    → P0001 tag_invalid（服务端白名单只有喜欢/告白/感谢/祝福/思念）
--   所以「寻物启事」必须新增一个写入函数，否则前端做得再好也发不出去。
--
-- 设计取舍：
--   不新建表，复用 wall 表（love_tag = '寻物' | '招领'）。
--   好处：现有的后台「内容」页可以直接隐藏/删除寻物帖，不需要改 Edge；
--         现有读取通道（REST / wall-cache）也能直接读到。
--   代价：寻物帖会出现在 wall 表里，前台表白墙必须按 tag 过滤（已改）。
--
-- 安全：
--   · SECURITY DEFINER + 固定 search_path，避免调用方篡改解析路径
--   · 所有字段在函数内做长度与必填校验，不依赖前端
--   · 同一 user_key 60 秒只能发 1 条（README 里写明：前端限流只是体验，这里才是真的）
--
-- 执行方式：Supabase Dashboard → SQL Editor → 粘贴 → Run
-- 回滚：见文件末尾
-- ============================================================================

begin;

-- 1) 两个新列：寻物状态 + 结构化字段（item/place/contact）
alter table public.wall add column if not exists lost_status text;
alter table public.wall add column if not exists lost_meta   jsonb;

-- 2) 让前台按 tag 拉取时不至于全表扫
create index if not exists wall_love_tag_ts_idx on public.wall (love_tag, created_ts desc);

-- 3) 发布寻物启事
create or replace function public.fn_lost_post(
  p_kind     text,          -- '寻物' | '招领'
  p_item     text,          -- 物品名称，如「绿色藤编钱包」
  p_place    text,          -- 地点，如「小雅堂四楼」
  p_desc     text,          -- 补充描述
  p_contact  text,          -- 联系方式 / 归还地点
  p_nick     text,          -- 昵称，可空（空则匿名）
  p_user_key text,          -- 设备身份，用于「我的投稿」和限流
  p_ip       text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item    text := btrim(coalesce(p_item, ''));
  v_place   text := btrim(coalesce(p_place, ''));
  v_desc    text := btrim(coalesce(p_desc, ''));
  v_contact text := btrim(coalesce(p_contact, ''));
  v_nick    text := btrim(coalesce(p_nick, ''));
  v_uk      text := btrim(coalesce(p_user_key, ''));
  v_last    bigint;
  v_now     bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_id      bigint;
  v_msg     text;
begin
  if p_kind is null or p_kind not in ('寻物', '招领') then
    return jsonb_build_object('ok', false, 'error', 'kind_invalid');
  end if;

  if length(v_item) = 0 then
    return jsonb_build_object('ok', false, 'error', 'item_required');
  end if;
  if length(v_item) > 20 then
    return jsonb_build_object('ok', false, 'error', 'item_too_long');
  end if;
  if length(v_place) > 30 then
    return jsonb_build_object('ok', false, 'error', 'place_too_long');
  end if;
  if length(v_desc) > 140 then
    return jsonb_build_object('ok', false, 'error', 'desc_too_long');
  end if;
  if length(v_contact) > 60 then
    return jsonb_build_object('ok', false, 'error', 'contact_too_long');
  end if;
  if length(v_nick) > 8 then
    return jsonb_build_object('ok', false, 'error', 'nick_too_long');
  end if;
  if length(v_uk) = 0 then
    return jsonb_build_object('ok', false, 'error', 'user_key_required');
  end if;

  -- 服务端限流：同一设备 60 秒 1 条（前端那个只是提示，可被清缓存绕过）
  select max(created_ts) into v_last
    from public.wall
   where user_key = v_uk
     and love_tag in ('寻物', '招领');
  if v_last is not null and v_now - v_last < 60000 then
    return jsonb_build_object('ok', false, 'error', 'too_fast',
                              'wait', ceil((60000 - (v_now - v_last)) / 1000.0));
  end if;

  -- 给人看的一句话（后台「内容」页、邮件报告都读这一列）
  v_msg := p_kind || '：' || v_item
        || case when v_place   <> '' then '｜地点：' || v_place else '' end
        || case when v_desc    <> '' then '｜' || v_desc else '' end
        || case when v_contact <> '' then '｜联系：' || v_contact else '' end;

  insert into public.wall (
    nickname, target_name, grade_year, class_no,
    sender_gender, target_gender,
    love_msg, love_tag, user_key, status,
    lost_status, lost_meta, created_ts,
    like_count, dislike_count, gift
  ) values (
    case when v_nick = '' then '匿名' else v_nick end,
    v_item, '', '',
    '', '',
    v_msg, p_kind, v_uk, 'ok',
    'open',
    jsonb_build_object('kind', p_kind, 'item', v_item, 'place', v_place,
                       'desc', v_desc, 'contact', v_contact),
    v_now,
    0, 0, ''
  )
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- 4) 作者标记「已找到 / 已认领」
create or replace function public.fn_lost_resolve(
  p_id       bigint,
  p_user_key text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
begin
  update public.wall
     set lost_status = 'found'
   where id = p_id
     and user_key = btrim(coalesce(p_user_key, ''))
     and love_tag in ('寻物', '招领')
     and status = 'ok';
  get diagnostics v_n = row_count;
  if v_n = 0 then
    return jsonb_build_object('ok', false, 'error', 'not_yours_or_missing');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- 5) 探针：前端用它判断「这个功能开了没有」
--    没执行本脚本时返回 404 PGRST202，页面据此显示「待开通」而不是报错
create or replace function public.fn_lost_ready()
returns jsonb
language sql
stable
as $$
  select jsonb_build_object('ok', true, 'version', 1);
$$;

create or replace function public.fn_lost_list(
  p_limit    int default 120,
  p_user_key text default null
)
returns setof jsonb
language sql
stable
as $$
  select jsonb_build_object(
           'id', id,
           'nick', nickname,
           'tag', love_tag,
           'lost', coalesce(lost_status, 'open'),
           'meta', coalesce(lost_meta, '{}'::jsonb),
           'ts', created_ts,
           -- 只回布尔，不把别人的 user_key 下发给前端
           'mine', (btrim(coalesce(p_user_key, '')) <> ''
                    and user_key = btrim(p_user_key)))
    from public.wall
   where love_tag in ('寻物', '招领')
     and status = 'ok'
   order by created_ts desc
   limit greatest(1, least(coalesce(p_limit, 120), 300));
$$;

grant execute on function public.fn_lost_post(text, text, text, text, text, text, text, text) to anon;
grant execute on function public.fn_lost_resolve(bigint, text) to anon;
grant execute on function public.fn_lost_ready() to anon;
grant execute on function public.fn_lost_list(int, text) to anon;

commit;

-- ============================================================================
-- 验证（执行完跑这三条，都应返回数据）
--   select public.fn_lost_ready();
--   select public.fn_lost_post('寻物','测试钱包','小雅堂四楼','内有证件','到6班找韦妙','韦妙','probe_key');
--   select public.fn_lost_list(5);
--
-- 回滚（把寻物功能彻底撤掉，已发布的内容仍在 wall 表里，可单独删除）
--   drop function if exists public.fn_lost_post(text, text, text, text, text, text, text, text);
--   drop function if exists public.fn_lost_resolve(bigint, text);
--   drop function if exists public.fn_lost_ready();
--   drop function if exists public.fn_lost_list(int);
--   drop index if exists public.wall_love_tag_ts_idx;
--   -- 列不建议删（可能已有数据），如需删除：
--   -- alter table public.wall drop column if exists lost_status;
--   -- alter table public.wall drop column if exists lost_meta;
-- ============================================================================
