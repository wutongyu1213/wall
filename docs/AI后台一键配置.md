# 让后台「AI 审核」点一下就能用（5 分钟一次性配置）

## 为什么不能直接把 key 写进页面

本站是**公开仓库 + 纯静态托管**。如果把 AI Key 写进 `assets/ai-review-panel.js`：

- 任何人打开后台 → F12 → 就能看到完整 key
- 拿到 key 的人可以用你的额度随便调
- GitHub 会永久保留这段提交历史，删掉也还在

**所以 key 只能放服务端。** 做法是加一个 Edge Function 当"中转"：
浏览器只发文本，函数在服务端拿 key 去调 AI，再返回判定结果。

---

## 配置步骤

代码已经在仓库里：`supabase/functions/wall-ai/index.ts`

### 第 1 步：打开 Functions 页面

```
https://supabase.com/dashboard/project/dpceuvqtwvhoipxhozxz/functions
```

（或：supabase.com/dashboard → 选项目 → 左侧 **Edge Functions**）

### 第 2 步：新建函数

点右上角 **Deploy a new function** → 选 **Via Editor**（不要选模板）

- Function name 填：`wall-ai`（必须一字不差）
- 编辑器里把默认代码全删掉
- 把 `supabase/functions/wall-ai/index.ts` 的**全部内容**粘进去
- 点 **Deploy**

部署成功后，函数列表里会出现 `wall-ai`，状态 `ACTIVE`。

### 第 3 步：加两个 Secret

位置在 **Project Settings → Edge Functions → Secrets**（新版也可能在 Functions 页面顶部的 **Secrets** 标签）。

| Name | Value | 说明 |
|---|---|---|
| `AI_API_KEY` | 你的 Agnes AI key（`sk-...`） | 必填 |
| `ADMIN_PWD` | 你的后台管理密码 | 必填，和 `wall-admin` 用同一个 |

> `ADMIN_PWD` 很可能**已经有了**（`wall-admin` 一直在用），先在列表里找一下，
> 有就不用重复加，没有才新建。

### 第 4 步：验证

打开后台 → 登录 → 点右下角 **AI** 按钮。

- 看到绿框「✅ 已由服务端配置好」→ **成功了**，直接点「开始检查」即可
- 看到黄框「还没配 AI_API_KEY」→ 回第 3 步补 Secret
- 什么都没变（还是三个输入框）→ 函数没部署成功，或者名字不是 `wall-ai`

---

## 配置前后对比

| | 配置前 | 配置后 |
|---|---|---|
| 老师要做什么 | 填接口地址、模型名、API Key | **只点一下** |
| key 在哪 | 管理员手机 localStorage（明文） | Supabase Secrets（服务端） |
| 换手机 / 清缓存 | 要重填 | 不用管 |
| 谁能用 | 拿到 key 的人 | 知道管理密码的人 |

---

## 如果配置失败

### 现象：点 AI 还是三个输入框

前端会先 `ping` 一次函数；**函数不存在 / 名字不对 / 密码不符**，都会安静退回手动模式（不会弹错，不打扰老师）。

排查顺序：

```bash
# 1) 函数是否真的部署了（把 anon key 换成 03-凭证.md 里的）
curl -s -X POST "https://dpceuvqtwvhoipxhozxz.supabase.co/functions/v1/wall-ai" \
  -H "apikey: <anon key>" -H "Authorization: Bearer <anon key>" \
  -H "Content-Type: application/json" \
  -d '{"admin":"<管理密码>","ping":true}'
```

- 返回 `{"ok":true,"configured":true,...}` → 后端好了，刷新后台页面
- 返回 `{"ok":true,"configured":false,...}` → 缺 `AI_API_KEY`
- 返回 `{"ok":false,"error":"bad_password"}` → Secret 里的 `ADMIN_PWD` 和后台密码不一致
- 返回 404 `{"code":"NOT_FOUND"}` → 函数没部署 / 名字拼错

### 现象：能看到「已配置」，但检查时每条都失败

多半是 AI 服务商的问题：

```bash
# 直接测服务商（用 key 换 models 列表，能返回就说明 key 有效）
curl -s "https://apihub.agnes-ai.com/v1/models" -H "Authorization: Bearer <AI key>"
```

- 401 → key 无效
- 403 + `Insufficient user quota` → 余额不足，换 `agnes-3.0-flash`（免费额度可能还在）
- 超时 → 该网关只允许 1~2 并发，函数已做串行，若仍超时可调大 `TIMEOUT_MS`

---

## 安全说明（要清楚的三件事）

1. **这个函数带密码校验**：没有 `admin` 密码一律 401。否则它就是个公开的免费 AI 代理，任何人都能刷你额度。
2. **key 不会下发到浏览器**：函数只返回判定结果（`risk` / `cat` / `reason`），从不回显 key。
3. **函数代码本身公开**（在仓库里），但它**不含任何密钥**——密钥只在你 Supabase 后台的 Secrets 里。

---

## 我改不了的部分

Edge Function 必须由**有 Supabase 账号权限的人**部署，我没有。

如果你进不去 Supabase Dashboard，那这套配置就暂时用不了——后台会一直是手动填 key 的模式（能用，只是每台设备要填一次）。

替代方案：找一个有权限的人按上面 4 步做一次，或者把 Dashboard 权限给你自己。
