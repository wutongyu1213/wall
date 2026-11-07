-- ============================================================================
--  02 · 生命周期清理
--  执行位置：Supabase Dashboard → SQL Editor
--  作用：把「越积越多、没人管」的三类数据纳入每日自动清理
--  幂等：可重复执行
-- ============================================================================
--  现状盘点：
--    wall（表白）：删除态保留 30 天 + cron 每日清理 ✅ 已有
--    wall-photos 孤儿照片：后台手动点按钮 ⚠️
--    wall_votes（投票）：无任何清理策略        ❌ 一学年后大量过期记录
--    candidate_photos（挂照）：无清理策略       ❌ 候选删除后照片记录悬空
--
--  本脚本只做「挂靠关系已断」的孤儿清理——这类记录永远不可能再被正确展示，
--  删掉零风险。不做基于时间的批量删除（那个需要你确认业务语义后再开）。
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 第 0 步：先看清两张表的结构，确认列名与本脚本假设一致
-- ---------------------------------------------------------------------------
select table_name, column_name, data_type
from information_schema.columns
where table_schema='public' and table_name in ('wall_votes','candidate_photos')
order by table_name, ordinal_position;


-- ---------------------------------------------------------------------------
-- 1. 清理函数
-- ---------------------------------------------------------------------------
create or replace function public.fn_wall_gc()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_votes  int := 0;
  v_photos int := 0;
begin
  -- ① 候选人已不存在 / 已非 ok 的投票记录
  delete from public.wall_votes v
  where not exists (
    select 1 from public.wall_candidates c
    where c.id = v.candidate_id and c.status = 'ok'
  );
  get diagnostics v_votes = row_count;

  -- ② 挂照指向的候选已不存在
  delete from public.candidate_photos p
  where not exists (
    select 1 from public.wall_candidates c where c.id = p.candidate_id
  );
  get diagnostics v_photos = row_count;

  return json_build_object(
    'ok', true,
    'orphan_votes', v_votes,
    'orphan_candidate_photos', v_photos,
    'ran_at', now()
  );
end;
$$;

comment on function public.fn_wall_gc() is
  '清理孤儿的投票与挂照记录（指向已删除/非 ok 候选）。每日 cron 调用。';

-- 只允许服务端调用，不开放给 anon
revoke all on function public.fn_wall_gc() from anon, authenticated;


-- ---------------------------------------------------------------------------
-- 2. 挂每日 cron（03:10，避开已有的 02:00 清理）
--    pg_cron 若未启用：Dashboard → Database → Extensions → 开启 pg_cron
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- 先摘掉同名旧任务，避免重复调度报错
    begin
      perform cron.unschedule('wall-gc');
    exception when others then null;
    end;
    perform cron.schedule('wall-gc', '10 3 * * *', $cron$ select public.fn_wall_gc(); $cron$);
    raise notice '已挂载 cron: wall-gc（每日 03:10）';
  else
    raise notice '未启用 pg_cron，跳过自动调度。可手动执行: select public.fn_wall_gc();';
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- 3. 立即试跑一次（幂等，可安全重复）
-- ---------------------------------------------------------------------------
select public.fn_wall_gc();


-- ---------------------------------------------------------------------------
-- 4. 确认任务已注册
-- ---------------------------------------------------------------------------
select jobid, schedule, command, jobname
from cron.job
where jobname = 'wall-gc';


-- ============================================================================
--  暂不包含（需要你先确认业务语义）
-- ============================================================================
--  · 按时间删除老投票：一学年一次投票季，90 天前的票确实可删，
--    但要先确认 wall_votes 是否有 created_at 列（见第 0 步输出），
--    以及「去年校花」是否还需要保留票数展示。
--  · wall 表软删除记录的超期物理删除：现有后台 cleanup act 已在做，
--    且「删除态」的时间戳列名未知，不在盲写范围内。
