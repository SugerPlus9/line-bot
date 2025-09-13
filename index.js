import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";

const app = express();
app.use(bodyParser.json());

// =============================
// 設定
// =============================
const LINE_ACCESS_TOKEN = process.env.LINE_ACCESS_TOKEN;
let adminGroupId = ""; // グループ登録で設定

// =============================
// データ保持
// =============================
const SEATS = ["T1","T2","T3","T4","T5","T6","V1","V2","V3"];
const pendingSeat = {};
const userNames = {};   // shortId(8桁) → 登録名
let logs = [];

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
  const userId = event.source.userId;

  // ===== 写真 =====
  if (msg.type !== "text") {
    if (event.source.type === "user") {
      const name = await resolveDisplayName(userId);
      logs.push({ userId, text: "写真", displayName: name });

      if (adminGroupId) {
        await pushMessage(adminGroupId, { type: "text", text: `${name} 写真` });
      }
      await replyMessage(event.replyToken, { type: "text", text: "写真承りました。" });
    }
    return;
  }

  const text = msg.text.trim();

  // ===== グループ登録 =====
  if (event.source.type === "group" && text === "グループ登録") {
    adminGroupId = event.source.groupId;
    await pushMessage(adminGroupId, { 
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
      if (adminGroupId) await pushMessage(adminGroupId, { type: "text", text: `[席] ${text}` });
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
  // 名前登録（例: 名前登録 U1234567まな）
  if (text.startsWith("名前登録")) {
    const raw = text.replace("名前登録", "").trim();
    const shortId = raw.slice(0,8);
    const name = raw.slice(8).trim();
    if (shortId && name) {
      userNames[shortId] = name;
      await pushMessage(adminGroupId, { type: "text", text: `登録: ${shortId} → ${name}` });
    }
    return;
  }

  // 名前変更（例: 名前変更 まな ゆみ）
  if (text.startsWith("名前変更")) {
    const raw = text.replace("名前変更", "").trim();
    const parts = raw.split(/\s+/);
    if (parts.length >= 2) {
      const oldName = parts[0];
      const newName = parts[1];
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
        msg += `${name} (${id})\n`;
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
  if (!to) return;
  const url = "https://api.line.me/v2/bot/message/push";
  const body = JSON.stringify({ to, messages: [message] });
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${LINE_ACCESS_TOKEN}` },
    body
  });
}

async function resolveDisplayName(userId) {
  const shortId = userId.slice(0,8);
  if (userNames[shortId]) return userNames[shortId]; // 登録済みは登録名
  try {
    const res = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
      headers: { Authorization: `Bearer ${LINE_ACCESS_TOKEN}` }
    });
    if (!res.ok) return `不明(${shortId})`;
    const data = await res.json();
    return `${data.displayName} (${shortId})`; // 未登録はLINE名 + 8桁ID
  } catch (e) {
    console.error("resolveDisplayName error:", e);
    return `不明(${shortId})`;
  }
}

// =============================
// サーバー起動
// =============================
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});