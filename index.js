import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";

const app = express();
app.use(bodyParser.json());

// =============================
// 環境変数（Renderダッシュボードで設定）
// =============================
const LINE_ACCESS_TOKEN = process.env.LINE_ACCESS_TOKEN;
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;

// =============================
// メモリ保存（再起動で消える）
// =============================
let ADMIN_GROUP_ID = null;       // 管理グループID
const nameMap = {};              // { userId: "源氏名" }
const logs = [];                 // [{ date, userId, name, text }]
const SEATS = ["T1","T2","T3","T4","T5","T6","V","V1","V2","V3"];

// =============================
// Webhook エントリーポイント
// =============================
app.post("/webhook", async (req, res) => {
  const events = req.body.events;
  if (!events || events.length === 0) return res.sendStatus(200);

  for (const event of events) {
    try {
      await handleEvent(event);
    } catch (err) {
      console.error("handleEvent error:", err);
    }
  }
  res.sendStatus(200);
});

// =============================
// イベント処理
// =============================
async function handleEvent(event) {
  if (event.type !== "message") return;
  const msg = event.message;

  // 管理グループからのコマンド
  if (event.source.type === "group") {
    await handleAdminCommand(event);
    return;
  }

  // 女の子から（個別トーク）
  if (event.source.type === "user") {
    const userId = event.source.userId;
    const text = msg.type === "text" ? msg.text.trim() : "";

    if (msg.type === "text") {
      // テーブル番号 → そのまま転送
      if (SEATS.includes(text)) {
        if (ADMIN_GROUP_ID) {
          await pushMessage(ADMIN_GROUP_ID, {
            type: "text",
            text: text
          });
        }
        await replyMessage(event.replyToken, {
          type: "text",
          text: `${text} 承りました。`,
          quickReply: { items: seatButtons() }
        });
        return;
      }

      // オーダー → 名前付きで転送
      const name = await resolveName(userId);
      if (ADMIN_GROUP_ID) {
        await pushMessage(ADMIN_GROUP_ID, {
          type: "text",
          text: `${name} ${text}`
        });
      }
      saveLog(userId, name, text);
      await replyMessage(event.replyToken, {
        type: "text",
        text: "承りました。",
        quickReply: { items: seatButtons() }
      });
      return;
    }

    if (msg.type === "image") {
      const name = await resolveName(userId);
      if (ADMIN_GROUP_ID) {
        await pushMessage(ADMIN_GROUP_ID, {
          type: "text",
          text: `${name} （写真）`
        });
      }
      saveLog(userId, name, "（写真）");
      await replyMessage(event.replyToken, {
        type: "text",
        text: "承りました。",
        quickReply: { items: seatButtons() }
      });
      return;
    }
  }
}

// =============================
// 管理グループ コマンド処理
// =============================
async function handleAdminCommand(event) {
  const text = event.message.type === "text" ? event.message.text.trim() : "";
  const groupId = event.source.groupId;

  // グループ登録
  if (text === "グループ登録") {
    ADMIN_GROUP_ID = groupId;
    await replyMessage(event.replyToken, { type: "text", text: "管理グループを登録しました。" });
    return;
  }

  // 名前登録
  if (text.startsWith("名前登録")) {
    const lines = text.split("\n").slice(1); // 1行目以降
    for (const line of lines) {
      const [id, name] = line.trim().split(/\s+/);
      if (id && name) nameMap[id] = name;
    }
    await replyMessage(event.replyToken, { type: "text", text: "名前を登録しました。" });
    return;
  }

  // 名前変更
  if (text.startsWith("名前変更")) {
    const parts = text.split(/\s+/);
    if (parts.length >= 3) {
      const oldName = parts[1];
      const newName = parts[2];
      for (const [id, n] of Object.entries(nameMap)) {
        if (n === oldName) nameMap[id] = newName;
      }
      await replyMessage(event.replyToken, { type: "text", text: `${oldName} を ${newName} に変更しました。` });
    }
    return;
  }

  // 名前一覧
  if (text === "名前一覧") {
    let out = "=== 登録名一覧 ===\n";
    for (const [id, name] of Object.entries(nameMap)) {
      out += `${name} / ${id}\n`;
    }
    await replyMessage(event.replyToken, { type: "text", text: out });
    return;
  }

  // 営業終了
  if (text === "営業終了") {
    const targetDate = getBusinessDate();
    const dayLogs = logs.filter(l => l.date === targetDate);

    if (dayLogs.length === 0) {
      await replyMessage(event.replyToken, { type: "text", text: `${targetDate} の記録はありません。` });
      return;
    }

    let raw = `=== ${targetDate} オーダー一覧 ===\n`;
    for (const l of dayLogs) raw += `${l.name} ${l.text}\n`;

    let summary = `=== ${targetDate} オーダー集計 ===\n`;
    const grouped = {};
    for (const l of dayLogs) {
      const key = `${l.name} ${l.text}`;
      grouped[key] = (grouped[key] || 0) + 1;
    }
    for (const [k, v] of Object.entries(grouped)) {
      summary += `${k}×${v}\n`;
    }

    if (ADMIN_GROUP_ID) {
      await pushMessage(ADMIN_GROUP_ID, { type: "text", text: raw });
      await pushMessage(ADMIN_GROUP_ID, { type: "text", text: summary });
    }
    return;
  }
}

// =============================
// 補助関数
// =============================

// 名前解決（登録済み → それを使う / 未登録 → LINE名）
async function resolveName(userId) {
  if (nameMap[userId]) return nameMap[userId];
  const res = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
    headers: { Authorization: `Bearer ${LINE_ACCESS_TOKEN}` }
  });
  if (!res.ok) return userId.slice(0, 6);
  const data = await res.json();
  return data.displayName || userId.slice(0, 6);
}

// ログ保存（日付も一緒に）
function saveLog(userId, name, text) {
  const date = getBusinessDate();
  logs.push({ date, userId, name, text });
}

// 営業日判定（20:00〜翌6:00 を同一営業日とする）
function getBusinessDate() {
  const now = new Date();
  now.setHours(now.getHours() + 9); // JSTに補正（サーバーUTC前提）
  const h = now.getHours();

  let date = new Date(now);
  if (h < 6) {
    date.setDate(date.getDate() - 1); // 翌6:00までは前日扱い
  }
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}

// 席ボタン
function seatButtons() {
  return SEATS.map(seat => ({
    type: "action",
    action: { type: "message", label: seat, text: seat }
  }));
}

// =============================
// LINE API ユーティリティ
// =============================
async function replyMessage(replyToken, message) {
  const url = "https://api.line.me/v2/bot/message/reply";
  const body = JSON.stringify({ replyToken, messages: [message] });
  await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LINE_ACCESS_TOKEN}`
    },
    body
  });
}

async function pushMessage(to, message) {
  const url = "https://api.line.me/v2/bot/message/push";
  const body = JSON.stringify({ to, messages: [message] });
  await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LINE_ACCESS_TOKEN}`
    },
    body
  });
}

// =============================
// サーバー起動
// =============================
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

