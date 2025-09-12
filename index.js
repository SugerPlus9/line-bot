import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";

const app = express();
app.use(bodyParser.json());

// =============================
// 設定
// =============================

// LINE Developers → Messaging API の「チャネルアクセストークン（長期）」
const LINE_ACCESS_TOKEN = process.env.LINE_ACCESS_TOKEN;

// 固定の管理グループID（直書き初期値）
let adminGroupId = "C913d1bb80352e75d7a89bb0ea871ee7";

// =============================
// データ保持（メモリ上）
// =============================
const SEATS = ["T1","T2","T3","T4","T5","T6","V1","V2","V3"];
const pendingSeat = {}; // ユーザーごとの選択席
const userNames = {};   // userId → 登録名
let logs = [];          // 営業ログ

// =============================
// Webhook
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

  // ===== 画像（写真） =====
  if (msg.type !== "text") {
    if (event.source.type === "user") {
      const userId = event.source.userId;
      const name = await resolveDisplayName(userId);
      logs.push({ userId, text: "写真", displayName: name });

      if (adminGroupId) {
        await pushMessage(adminGroupId, { type: "text", text: `${name} 写真` });
      }
    }
    return;
  }

  const text = msg.text.trim();
  const userId = event.source.userId;

  // ===== グループ登録 =====
  if (event.source.type === "group" && text === "グループ登録") {
    adminGroupId = event.source.groupId;
    await replyMessage(event.replyToken, {
      type: "text",
      text: `✅ 管理グループとして登録しました。\nID: ${adminGroupId}`
    });
    return;
  }

  // ===== 管理グループでのコマンド =====
  if (event.source.type === "group" && event.source.groupId === adminGroupId) {
    await handleAdminCommand(text);
    return;
  }

  // ===== 女の子からの入力 =====
  if (event.source.type === "user") {
    // 席選択
    if (SEATS.includes(text)) {
      pendingSeat[userId] = text;
      await replyMessage(event.replyToken, { type: "text", text: `${text} 承りました。` });
      if (adminGroupId) await pushMessage(adminGroupId, { type: "text", text: `[${text}]` });
      return;
    }

    // オーダー入力
    const seat = pendingSeat[userId];
    const name = await resolveDisplayName(userId);
    logs.push({ userId, text, displayName: name });

    if (adminGroupId) {
      await pushMessage(adminGroupId, { type: "text", text: `${name} ${text}` });
    }

    await replyMessage(event.replyToken, { type: "text", text: "オーダー承りました。" });
  }
}

// =============================
// 管理グループコマンド
// =============================
async function handleAdminCommand(text) {
  // 名前登録
  if (text.startsWith("名前登録")) {
    const parts = text.split(" ");
    if (parts.length >= 3) {
      const id = parts[1];
      const name = parts[2];
      userNames[id] = name;
      await pushMessage(adminGroupId, { type: "text", text: `登録: ${id.slice(0,6)} → ${name}` });
    }
    return;
  }

  // 名前変更
  if (text.startsWith("名前変更")) {
    const parts = text.split(" ");
    if (parts.length >= 3) {
      const oldName = parts[1];
      const newName = parts[2];
      const foundId = Object.keys(userNames).find(id => userNames[id] === oldName);
      if (foundId) {
        userNames[foundId] = newName;
        await pushMessage(adminGroupId, { type: "text", text: `${oldName} → ${newName} に変更しました。` });
      }
    }
    return;
  }

  // 名前一覧
  if (text === "名前一覧") {
    let msg = "📋 登録一覧\n";
    if (Object.keys(userNames).length === 0) {
      msg += "なし";
    } else {
      for (const [id, name] of Object.entries(userNames)) {
        msg += `${name} (${id.slice(0,6)})\n`;
      }
    }
    await pushMessage(adminGroupId, { type: "text", text: msg });
    return;
  }

  // 営業終了
  if (text === "営業終了") {
    const now = new Date();
    if (now.getHours() < 6) now.setDate(now.getDate() - 1);
    const dateStr = `${now.getFullYear()}/${now.getMonth()+1}/${now.getDate()}`;

    // 一覧
    let summary = `=== ${dateStr} オーダー一覧 ===\n`;
    logs.forEach(item => {
      summary += `${item.displayName} ${item.text}\n`;
    });

    // 集計
    const counts = {};
    logs.forEach(item => {
      const key = `${item.displayName} ${item.text}`;
      counts[key] = (counts[key] || 0) + 1;
    });
    let grouped = `\n=== ${dateStr} オーダー集計 ===\n`;
    for (const [k,v] of Object.entries(counts)) {
      grouped += `${k} ×${v}\n`;
    }

    await pushMessage(adminGroupId, { type: "text", text: summary + grouped });
    logs = [];
    return;
  }
}

// =============================
// ユーティリティ
// =============================
async function replyMessage(replyToken, message) {
  const url = "https://api.line.me/v2/bot/message/reply";
  const body = JSON.stringify({ replyToken, messages: [message] });
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${LINE_ACCESS_TOKEN}` },
    body
  });
}

async function pushMessage(to, message) {
  const url = "https://api.line.me/v2/bot/message/push";
  const body = JSON.stringify({ to, messages: [message] });
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${LINE_ACCESS_TOKEN}` },
    body
  });
}

async function resolveDisplayName(userId) {
  if (userNames[userId]) return userNames[userId]; // 登録済みは登録名
  try {
    const res = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
      headers: { Authorization: `Bearer ${LINE_ACCESS_TOKEN}` }
    });
    if (!res.ok) return `不明(${userId.slice(0,6)})`;
    const data = await res.json();
    return `${data.displayName} (${userId.slice(0,6)})`;
  } catch (e) {
    console.error("resolveDisplayName error:", e);
    return `不明(${userId.slice(0,6)})`;
  }
}

// =============================
// サーバー起動
// =============================
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});