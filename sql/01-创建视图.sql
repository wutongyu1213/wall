-- ============================================================================
--  01 · 创建公开视图（第 1 步，只加不加减，零风险）
--  执行位置：Supabase Dashboard → SQL Editor
--
--  ⚠️ 本文件【不含任何 revoke】。执行后旧前端照常工作，新前端也能用。
--     真正的权限收回在 03-收口revoke.sql，必须在【前端部署完成之后】才跑。
--     这个拆分是为了避免"改了库没改前端"造成的那几分钟白屏。
-- ============================================================================
--  为什么需要这一批：
--  写路径早已收口到 RPC（很好），但读权限一直按「前端需要什么」开放，
--  而不是按「访客应该看什么」。实测匿名用公开 key 能读到：
--    wall.user_key / semantic_review / author_id / status
--    wall_candidates 的全部审核字段（真名、reject_reason、reviewed_by、ai_review）
--  修法：对外只给视图，原表最后收回权限。Edge 用 service_role，不受影响。
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 第 0 步：看清现状（只读）
-- ---------------------------------------------------------------------------
select table_name, privilege_type
from information_schema.role_table_grants
where grantee = 'anon' and table_schema = 'public'
order by table_name, privilege_type;


-- ---------------------------------------------------------------------------
-- 1. wall → wall_public（表白墙）
--    白名单字段 + 仅 status='ok'。hidden / 软删除态从此不再对匿名可见。
--    保留 dislike_count：前端批量同步计数的查询里还在用它。
-- ---------------------------------------------------------------------------
create or replace view public.wall_public as
select
  id, nickname, target_name, grade_year, class_no, love_tag,
  sender_gender, target_gender, love_msg,
  like_count, dislike_count, gift, created_ts
from public.wall
where status = 'ok';

comment on view public.wall_public is
  '表白墙公开视图：字段白名单 + 仅 status=ok。匿名只读此视图。';

grant select on public.wall_public to anon, authenticated;


-- ---------------------------------------------------------------------------
-- 2. wall_candidates → wall_candidates_public（照片墙候选）
--    收回：status / reject_reason / reviewed_at / reviewed_by / ai_review / auto_review
--    这几个字段组合起来能反推出「谁被拒了、为什么被拒」，不该公开。
-- ---------------------------------------------------------------------------
create or replace view public.wall_candidates_public as
select
  id, kind, nickname, class_no, photo_url,
  like_count, msg, voting_on, created_ts
from public.wall_candidates
where status = 'ok';

comment on view public.wall_candidates_public is
  '照片墙候选公开视图：仅 status=ok，不含审核痕迹。';

grant select on public.wall_candidates_public to anon, authenticated;


-- ---------------------------------------------------------------------------
-- 3. candidate_photos → candidate_photos_public（同名多照）
-- ---------------------------------------------------------------------------
create or replace view public.candidate_photos_public as
select candidate_id, photo_url, seq
from public.candidate_photos
where status = 'ok';

grant select on public.candidate_photos_public to anon, authenticated;


-- ---------------------------------------------------------------------------
-- 4. 验证：三个视图都能读，且字段是白名单
-- ---------------------------------------------------------------------------
select * from public.wall_public            order by created_ts desc limit 3;
select * from public.wall_candidates_public order by created_ts desc limit 3;
select count(*) as public_photo_rows from public.candidate_photos_public;

-- 预期：wall_public 不应出现 user_key / semantic_review / status 这三列
