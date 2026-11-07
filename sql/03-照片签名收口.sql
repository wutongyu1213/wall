-- ============================================================================
--  03 · 照片签名收口 —— 全仓库风险最高的一步
--  执行位置：Supabase Dashboard → SQL Editor
--
--  ============================ 先读这段 ============================
--  这一步会把「匿名对 wall-photos 的 SELECT 权限」收回。
--  收起之后，只有 wall-photo-sign 这个 Edge（用 service key）能签名。
--
--  如果 wall-photo-sign 还没部署，执行本步的后果是：
--      【全站照片立刻全部无法显示】—— 因为前端没有别的签名途径。
--
--  当前状态（2026-11-07 实测）：wall-photo-sign 返回 404，**尚未部署**。
--  所以：本文件现在不要执行。
--  ==================================================================
--
--  为什么这一步必须做：
--     前端要匿名直传照片（INSERT，保留），过去又要匿名自签（需要 SELECT）。
--     正是这个 SELECT，让任何人可以读 wall_candidates 拿到照片路径，
--     再对任意路径签名，读到【还没过审】甚至【已被拒绝】的学生照片。
--     实测可完整走通：读候选表 → 调 /object/sign → HTTP 200 拿到 103KB 照片。
--     照片预审、NSFW 检测、人工复核，整条防线只拦走界面的人。
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 0. 前置检查：Edge 是否真的部署了
--    （SQL 里查不到 Edge，请先用 curl 验证，命令见 sql/README.md）
--    返回 {"ok":true,...} 才继续往下。
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 1. 看清现有的存储策略（只读，不改任何东西）
-- ---------------------------------------------------------------------------
select policyname, cmd, roles::text as roles,
       left(coalesce(qual::text,''), 140) as using_expr
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
order by cmd, policyname;


-- ---------------------------------------------------------------------------
-- 2. 只删「SELECT + 提到 wall-photos」的策略，其它一律不碰
--    逐条打印删了哪些，方便你核对
-- ---------------------------------------------------------------------------
do $$
declare r record; n int := 0;
begin
  for r in
    select policyname
    from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and cmd = 'SELECT'
      and coalesce(qual::text,'') like '%wall-photos%'
  loop
    execute format('drop policy %I on storage.objects', r.policyname);
    raise notice '已删除策略: %', r.policyname;
    n := n + 1;
  end loop;
  raise notice '共删除 % 条 SELECT 策略', n;
  if n = 0 then
    raise notice '没有匹配到策略 —— 可能策略名或表达式不含 wall-photos，请回到第 1 步人工核对';
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- 3. 确认上传用的 INSERT 策略还在（这个不能删，删了前端就传不了照片）
-- ---------------------------------------------------------------------------
select policyname, cmd
from pg_policies
where schemaname = 'storage' and tablename = 'objects' and cmd = 'INSERT';


-- ---------------------------------------------------------------------------
-- 4. 验证（在浏览器或终端执行，不是 SQL）
-- ---------------------------------------------------------------------------
-- 4.1 匿名签名应失败（期望 4xx）
--   curl -X POST "https://dpceuvqtwvhoipxhozxz.supabase.co/storage/v1/object/sign/wall-photos/<任意路径>" \
--     -H "apikey: <anon key>" -H "Authorization: Bearer <anon key>" \
--     -H "Content-Type: application/json" -d '{"expiresIn":900}'
--
-- 4.2 前端照片仍能显示（走 Edge 签名）
--   打开校花墙，图片应正常加载；F12 Network 里签名请求应打到 /functions/v1/wall-photo-sign
--
-- 4.3 匿名上传仍可用（走前端发一张测试照片）
--   如果 4.3 失败，说明 INSERT 策略被误删，执行下面回滚的第 2 段


-- ============================================================================
--  回滚
-- ============================================================================
-- 1) 恢复读取（照片立刻恢复，但安全洞也一起恢复）
--    create policy "anon read wall-photos" on storage.objects
--      for select to anon using (bucket_id = 'wall-photos');
--
-- 2) 若 INSERT 策略被误删，按原定义重建（先从备份或 Dashboard 的 Policies 页找原文）
