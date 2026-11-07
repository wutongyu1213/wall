-- ============================================================================
--  02 · 收回原表的匿名读权限
--  执行位置：Supabase Dashboard → SQL Editor
--
--  ⚠️ 前置条件（缺一不可）：
--     1) 已执行 01-创建视图.sql
--     2) 前端已部署，且打开表白墙 / 校花 / 校草 三页确认内容正常
--        验证方法：浏览器控制台执行
--          (await supabase.from('wall_public').select('id').limit(1)).error   // 应为 null
--     3) 打开任意一条表白详情，确认照片能显示（本步不动存储，照片不受影响）
--
--  本步【不涉及 Storage】。照片签名的收口在 03-照片签名收口.sql，
--  那一步风险更高，必须等 Edge 部署完再做。
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 0. 先看清现状（只读，不改任何东西）
-- ---------------------------------------------------------------------------
select table_name, privilege_type
from information_schema.role_table_grants
where grantee = 'anon' and table_schema = 'public'
order by table_name, privilege_type;


-- ---------------------------------------------------------------------------
-- 1. 收回三张原表的匿名读
--    收回后前端只能走视图（01 建的），视图是字段白名单 + 仅 status='ok'
-- ---------------------------------------------------------------------------
revoke select on public.wall             from anon;
revoke select on public.wall_candidates  from anon;
revoke select on public.candidate_photos from anon;


-- ---------------------------------------------------------------------------
-- 2. 清理 card_gifts 的重复外键
--    实测存在两条指向 wall 的外键：card_gifts_wall_id_fkey 与 fk_gifts_wall
--    两条同时存在会让 PostgREST 的 embed 查询报 PGRST201 歧义。
--    先看清，再删命名不规范的那条。
-- ---------------------------------------------------------------------------
select conname, pg_get_constraintdef(oid) as def
from pg_constraint
where conrelid = 'public.card_gifts'::regclass and contype = 'f';

alter table public.card_gifts drop constraint if exists fk_gifts_wall;


-- ---------------------------------------------------------------------------
-- 3. 验证
-- ---------------------------------------------------------------------------
-- 3.1 原表应被拒（期望 42501 permission denied）
--     控制台： (await supabase.from('wall').select('id').limit(1)).error
--
-- 3.2 视图应正常
--     控制台： (await supabase.from('wall_public').select('*').limit(3)).data
--
-- 3.3 视图不应包含内部字段
--     控制台： Object.keys((await supabase.from('wall_public').select('*').limit(1)).data[0])
--     期望不含：status / author_id / user_key / semantic_review


-- ============================================================================
--  回滚（页面白屏时立刻执行，10 秒恢复）
-- ============================================================================
-- grant select on public.wall             to anon;
-- grant select on public.wall_candidates  to anon;
-- grant select on public.candidate_photos to anon;
