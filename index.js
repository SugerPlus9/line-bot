import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";

const app = express();
app.use(bodyParser.json());

// =============================
// 環境変数
// =============================
const LINE_ACCESS_TOKEN = process.env.LINE_ACCESS_TOKEN;

// =============================
// 固定値
// =============================
let ADMIN_GROUP_ID = ""; // 「グループ登録」でセット
const SEATS = ["T1","T2","T3","T4","T5","T6","V","V1","V2","V3"];

const pendingSeat = {};   // 席選択中のユーザー
let seatLogs = {};        // ログ保存 { userId: { name, items: [] } }
let nameRegistry = {};    // 名前管理 { userId: genjiName }

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

  // 管理グループからの操作
  if (event.source.type === "group" && msg.type === "text") {
    await handleAdminCommand(event);
    return;
  }

  // 女の子からのトーク
  if (event.source.type === "user") {
    if (msg.type === "text") {
      await handleUserText(event);
    } else if (msg.type === "image") {
      await handleUserImage(event);
    }
  }
}

// =============================
// 管理グループ コマンド
// =============================
async function handleAdminCommand(event) {
  const text = event.message.text.trim();
  const groupId = event.source.groupId;

  // グループ登録
  if (text === "グループ登録") {
    ADMIN_GROUP_ID = groupId;
    await replyMessage(event.replyToken, { type: "text", text: "管理グループとして登録しました。" });
    return;
  }

  // 名前登録（複数行）
  if (text.startsWith("名前登録")) {
    const lines = text.split("\n").slice(1);
    lines.forEach(line => {
      const [id, name] = line.trim().split(/\s+/);
      if (id && name) nameRegistry[id] = name;
    });
    await replyMessage(event.replyToken, { type: "text", text: "名前を登録しました。" });
    return;
  }

  // 名前変更
  if (text.startsWith("名前変更")) {
    const [, oldName, newName] = text.split(/\s+/);
    for (const [id, n] of Object.entries(nameRegistry)) {
      if (n === oldName) nameRegistry[id] = newName;
    }
    await replyMessage(event.replyToken, { type: "text", text: `${oldName} を ${newName} に変更しました。` });
    return;
  }

  // 名前一覧
  if (text === "名前一覧") {
    const list = Object.entries(nameRegistry)
      .map(([id, name]) => `${id} → ${name}`)
      .join("\n") || "登録なし";
    await replyMessage(event.replyToken, { type: "text", text: list });
    return;
  }

  // 営業終了まとめ
  if (text === "営業終了") {
    const today = getBusinessDate();
    const [listReport, summaryReport] = buildDailyReports(today);
    if (ADMIN_GROUP_ID) {
      await pushMessage(ADMIN_GROUP_ID, { type: "text", text: listReport });
      await pushMessage(ADMIN_GROUP_ID, { type: "text", text: summaryReport });
    }
    seatLogs = {}; // リセット
    return;
  }
}

// =============================
// 女の子側：テキスト
// =============================
async function handleUserText(event) {
  const userId = event.source.userId;
  const replyToken = event.replyToken;
  const text = event.message.text.trim();

  // 席選択
  if (SEATS.includes(text)) {
    pendingSeat[userId] = text;

    const name = await resolveName(userId);
    if (ADMIN_GROUP_ID) {
      await pushMessage(ADMIN_GROUP_ID, { type: "text", text: `[${text}] ${name}` });
    }

    // 席選択時は返信しない
    return;
  }

  // オーダー入力
  const name = await resolveName(userId);
  const seat = pendingSeat[userId] || "-";

  logOrder(userId, name, text);

  if (ADMIN_GROUP_ID) {
    await pushMessage(ADMIN_GROUP_ID, { type: "text", text: `[${seat}] ${name}\n${text}` });
  }

  await replyMessage(replyToken, seatQuickReply("オーダー承りました。"));
}

// =============================
// 女の子側：画像
// =============================
async function handleUserImage(event) {
  const userId = event.source.userId;
  const replyToken = event.replyToken;
  const name = await resolveName(userId);
  const seat = pendingSeat[userId] || "-";

  logOrder(userId, name, "（写真）");

  if (ADMIN_GROUP_ID) {
    await pushMessage(ADMIN_GROUP_ID, { type: "text", text: `[${seat}] ${name}\n（写真）` });
  }

  await replyMessage(replyToken, seatQuickReply("写真承りました。"));
}

// =============================
// QuickReply生成
// =============================
function seatQuickReply(text) {
  return {
    type: "text",
    text: text,
    quickReply: {
      items: SEATS.map(seat => ({
        type: "action",
        action: { type: "message", label: seat, text: seat }
      }))
    }
  };
}

// =============================
// ログ操作
// =============================
function logOrder(userId, name, item) {
  if (!seatLogs[userId]) seatLogs[userId] = { name, items: [] };
  seatLogs[userId].items.push(item);
}

function buildDailyReports(dateStr) {
  let listReport = `=== ${dateStr} 営業終了まとめ（オーダー一覧） ===\n\n`;
  let summaryReport = `=== ${dateStr} 営業終了まとめ（オーダー集計） ===\n\n`;

  for (const userId of Object.keys(seatLogs)) {
    const log = seatLogs[userId];
    listReport += `[${log.name}]\n`;
    summaryReport += `[${log.name}]\n`;

    // 一覧
    log.items.forEach(i => listReport += `・${i}\n`);

    // 集計
    const counts = {};
    log.items.forEach(i => counts[i] = (counts[i] || 0) + 1);
    Object.entries(counts).forEach(([item, count]) => {
      summaryReport += `・${item} ×${count}\n`;
    });

    listReport += "\n";
    summaryReport += "\n";
  }

  listReport += "==============================";
  summaryReport += "==============================\n";
  summaryReport += `営業終了 ${formatShortDate(dateStr)}`;

  return [listReport, summaryReport];
}

// 日付判定（0〜5時は前日扱い）
function getBusinessDate() {
  const now = new Date();
  if (now.getHours() < 6) now.setDate(now.getDate() - 1);
  return `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()}`;
}

function formatShortDate(dateStr) {
  const [, m, d] = dateStr.split("/");
  return `${m}/${d}`;
}

// =============================
// 名前解決
// =============================
async function resolveName(userId) {
  // 登録済みなら源氏名を返す
  if (nameRegistry[userId]) return nameRegistry[userId];

  try {
    const res = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
      headers: { Authorization: `Bearer ${LINE_ACCESS_TOKEN}` },
    });
    if (!res.ok) return `${userId.slice(0,6)}`;

    const data = await res.json();
    const displayName = data.displayName || userId.slice(0,6);

    // 未登録は displayName + (短縮ID)
    return `${displayName} (${userId.slice(0,6)})`;
  } catch {
    return `${userId.slice(0,6)}`;
  }
}

// =============================
// LINE API呼び出し
// =============================
async function replyMessage(replyToken, message) {
  await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LINE_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({ replyToken, messages: [message] }),
  });
}

async function pushMessage(to, message) {
  await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LINE_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({ to, messages: [message] }),
  });
}

// =============================
// サーバー起動
// =============================
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on port ${port}`));

