# 数据库脚本

按顺序执行，**不要跳步**。每一步都写了前置条件和验证方法，执行前读一遍。

| 步骤 | 文件 | 风险 | 前置条件 |
|---|---|---|---|
| 1 | `01-创建视图.sql` | 无（只增不改） | 无 |
| 2 | `02-收回表读权限.sql` | 低 | 前端已部署并确认三页正常 |
| 3 | `03-照片签名收口.sql` | **高** | `wall-photo-sign` Edge 已部署并验证通过 |
| 4 | `04-清理与生命周期.sql` | 低 | 需要 pg_cron |

---

## 为什么拆成四步

原来的写法把「建视图 + 收回表权限 + 收回存储权限」塞在一个文件里，一次执行会同时触发两种故障：

- 前端还没读视图就收回表权限 → **整站白屏**
- 照片签名还没挪到 Edge 就收回存储权限 → **所有照片变空**

拆开之后每一步都能单独验证、单独回滚。

---

## 第 1 步之后会发生什么

视图建好后，前端的 `wallSrc()` 探测到 `wall_public` 存在，会自动切过去读视图。
此时原表**仍然可读**（没收回），所以旧版前端不受影响。这一步是零风险的。

## 第 2 步之后

匿名读 `wall` 原表会被拒（42501）。前端走视图，正常。
**如果此时页面白屏**，说明前端没更新 → 立刻执行回滚语句（见文件末尾）。

## 第 3 步是唯一有真实风险的一步

`wall-photo-sign` 目前**还没有部署**（实测 404）。在它部署之前执行本步，
全站照片会立刻全部无法显示，因为前端没有别的签名途径。

先做这两件事再执行：
1. 部署 `wall-photo-sign`（代码在 `photo-fix/` 目录，或在仓库历史里找）
2. 打开三个页面确认照片仍能正常显示（此时前端会优先走 Edge）

验证 Edge 是否真的在工作的最快方法：

```bash
curl -s -X POST "https://dpceuvqtwvhoipxhozxz.supabase.co/functions/v1/wall-photo-sign" \
  -H "apikey: <anon key>" -H "Authorization: Bearer <anon key>" \
  -H "Content-Type: application/json" \
  -d '{"paths":["xiaohua/任意已过审照片.jpg"]}' -w "\nHTTP %{http_code}\n"
```

返回 `{"ok":true,"urls":{...}}` 才算成功；返回 404 说明没部署。

---

## 当前状态（2026-11-07 实测）

| 项目 | 状态 |
|---|---|
| `wall_public` 视图 | ❌ 未创建（HTTP 404） |
| `wall_candidates_public` | ❌ 未创建 |
| `candidate_photos_public` | ❌ 未创建 |
| `wall` 原表匿名读 | ⚠️ 仍开放，泄露 `status`/`author_id`/`user_key`/`semantic_review` |
| `wall_candidates` 原表匿名读 | ⚠️ 仍开放，含真名与审核痕迹 |
| 匿名照片签名 | ⚠️ 仍开放（可签名任意路径，含未过审照片） |
| `wall-photo-sign` Edge | ❌ 未部署 |
| `card_gifts` 重复外键 | ⚠️ 未清理 |

**这 7 项全部还开着。** 本目录的脚本就是为了关掉它们。
