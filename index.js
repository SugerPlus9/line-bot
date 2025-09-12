
import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";

const app = express();
app.use(bodyParser.json());

// =============================
// 環境変数
// =============================
const LINE_ACCESS_TOKEN = process.env.LINE_ACCESS_TOKEN;
const ADMIN_GROUP_ID = process.env.ADMIN_GROUP_ID;

// 名前データ（再起動で消える）
const nameMap = {}; // userId → 登録名
let logs = {};      // 日付ごとにログを保存
let currentDate = null;

// =============================
// 席一覧
// =============================
const SEATS = ["T1", "T2", "T3", "T4", "T5", "T6", "V1", "V2", "V3"];

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
  if (event.type !== "message" || event.message.type !== "text") return;

  const text = event.message.text.trim();
  const sourceId =
    event.source.userId || event.source.groupId || event.source.roomId;

  // 管理グループのコマンド
  if (event.source.type === "group" && sourceId === ADMIN_GROUP_ID) {
    await handleAdminCommand(text, event.replyToken);
    return;
  }

  // 女の子からのオーダー
  if (event.source.type === "user") {
    await handleOrder(event);
  }
}

// =============================
// 管理グループコマンド
// =============================
async function handleAdminCommand(text, replyToken) {
  // 名前登録
  if (text.startsWith("名前登録")) {
    const parts = text.split(" ");
    if (parts.length >= 3) {
      const id = parts[1];
      const name = parts[2];
      nameMap[id] = name;
      await replyText(replyToken, `名前を登録しました: ${id} → ${name}`);
    } else {
      await replyText(replyToken, "使い方: 名前登録 <UserID先頭6桁> <名前>");
    }
    return;
  }

  // 名前変更
  if (text.startsWith("名前変更")) {
    const parts = text.split(" ");
    if (parts.length >= 3) {
      const oldName = parts[1];
      const newName = parts[2];
      let updated = false;
      for (const [id, name] of Object.entries(nameMap)) {
        if (name === oldName) {
          nameMap[id] = newName;
          updated = true;
        }
      }
      if (updated) {
        await replyText(replyToken, `${oldName} を ${newName} に変更しました。`);
      } else {
        await replyText(replyToken, `${oldName} は登録されていません。`);
      }
    } else {
      await replyText(replyToken, "使い方: 名前変更 <旧名> <新名>");
    }
    return;
  }

  // 名前一覧
  if (text === "名前一覧") {
    let msg = "📋 登録一覧:\n";
    for (const [id, name] of Object.entries(nameMap)) {
      msg += `${name} (${id})\n`;
    }
    if (msg === "📋 登録一覧:\n") msg = "登録なし";
    await replyText(replyToken, msg);
    return;
  }

  // 営業終了
  if (text === "営業終了") {
    if (!currentDate) {
      await replyText(replyToken, "本日のログはありません。");
      return;
    }

    const todayLogs = logs[currentDate] || [];
    if (todayLogs.length === 0) {
      await replyText(replyToken, "本日のログはありません。");
      return;
    }

    // 集計
    const summary = {};
    for (const log of todayLogs) {
      const key = log.name + (log.item === "写真" ? " (写真)" : "");
      if (!summary[key]) summary[key] = 0;
      summary[key] += 1;
    }

    let msg = `📌 ${currentDate} のまとめ\n\n--- オーダー一覧 ---\n`;
    for (const log of todayLogs) {
      msg += `${log.name} ${log.item}\n`;
    }
    msg += "\n--- 集計 ---\n";
    for (const [key, count] of Object.entries(summary)) {
      msg += `${key} ×${count}\n`;
    }

    await pushMessage(ADMIN_GROUP_ID, { type: "text", text: msg });

    // 次の日に備えてリセット
    logs = {};
    currentDate = null;
    return;
  }
}

// =============================
// オーダー処理
// =============================
async function handleOrder(event) {
  const userId = event.source.userId;
  const text = event.message.text.trim();

  const seat = SEATS.find((s) => text.startsWith(s));
  let orderText = text;

  if (seat) {
    orderText = text.replace(seat, "").trim();
  }

  // 名前の決定
  let displayName;
  if (nameMap[userId]) {
    displayName = nameMap[userId]; // 登録名
  } else {
    const profile = await getProfile(userId);
    const lineName = profile.displayName || "不明";
    displayName = `${lineName} (${userId.slice(0, 6)})`;
  }

  const logItem = orderText === "" ? "オーダーなし" : orderText;

  // 日付キーを決定
  const now = new Date();
  let logDate;
  if (now.getHours() < 6) {
    now.setDate(now.getDate() - 1);
  }
  logDate = `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()}`;
  currentDate = logDate;

  if (!logs[logDate]) logs[logDate] = [];
  logs[logDate].push({ name: displayName, item: logItem });

  // 管理グループへ送信
  await pushMessage(ADMIN_GROUP_ID, {
    type: "text",
    text: seat ? `[${seat}] ${displayName}\n${logItem}` : `${displayName}\n${logItem}`,
  });

  // 女の子へ返信
  if (seat) {
    await replyText(event.replyToken, `${seat} 承りました。`);
  } else {
    await replyText(event.replyToken, "オーダー承りました。");
  }
}

// =============================
// ユーティリティ
// =============================
async function replyText(replyToken, text) {
  const url = "https://api.line.me/v2/bot/message/reply";
  const body = JSON.stringify({
    replyToken: replyToken,
    messages: [{ type: "text", text: text }],
  });
  await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LINE_ACCESS_TOKEN}`,
    },
    body,
  });
}

async function pushMessage(to, message) {
  console.log("pushMessage to:", to);
  const url = "https://api.line.me/v2/bot/message/push";
  const body = JSON.stringify({ to, messages: [message] });
  await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LINE_ACCESS_TOKEN}`,
    },
    body,
  });
}

async function getProfile(userId) {
  try {
    const url = `https://api.line.me/v2/bot/profile/${userId}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${LINE_ACCESS_TOKEN}` },
    });
    if (!res.ok) return {};
    return await res.json();
  } catch (err) {
    console.error("getProfile error:", err);
    return {};
  }
}

// =============================
// サーバー起動
// =============================
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
