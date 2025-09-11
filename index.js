import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";

const app = express();
app.use(bodyParser.json());

// =============================
// 環境変数
// =============================
const LINE_ACCESS_TOKEN = process.env.LINE_ACCESS_TOKEN;
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;

// 管理グループID（固定）
const ADMIN_GROUP_ID = "Uf05b8a44ed7e497f34401e799683af5f";

// 席一覧
const SEATS = ["T1","T2","T3","T4","T5","T6","V","V1","V2","V3"];
const pendingSeat = {};

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

  if (event.source.type === "user" && msg.type === "text") {
    const userId = event.source.userId;
    const text = msg.text.trim();

    // 席選択
    if (SEATS.includes(text)) {
      pendingSeat[userId] = text;
      const name = await getDisplayName(userId);

      // 管理グループに流す
      await pushMessage(ADMIN_GROUP_ID, {
        type: "text",
        text: `[${text}] ${name}`,
      });

      // 女の子に返す
      await replyMessage(event.replyToken, {
        type: "text",
        text: `${text} 承りました。`,
      });
      return;
    }

    // 席が選択済みならオーダー
    if (pendingSeat[userId]) {
      const seat = pendingSeat[userId];
      delete pendingSeat[userId];
      const name = await getDisplayName(userId);

      // 管理グループ
      await pushMessage(ADMIN_GROUP_ID, {
        type: "text",
        text: `${name}\n${text}`,
      });

      // 女の子に返す
      await replyMessage(event.replyToken, flexWithText("オーダー承りました。"));
      return;
    }

    // 席が未選択なら案内
    await replyMessage(event.replyToken, flexWithText("席を選んでください。"));
  }

  // 写真対応
  if (event.source.type === "user" && msg.type === "image") {
    const userId = event.source.userId;
    const seat = pendingSeat[userId];
    delete pendingSeat[userId];
    const name = await getDisplayName(userId);

    // 管理グループ
    await pushMessage(ADMIN_GROUP_ID, {
      type: "text",
      text: `${name}\n（写真）`,
    });

    // 女の子に返す
    await replyMessage(event.replyToken, flexWithText("写真承りました。"));
  }
}

// =============================
// Flexメッセージ生成
// =============================
function flexWithText(text) {
  return {
    type: "flex",
    altText: "席を選んでください",
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "text", text: text, wrap: true },
          ...SEATS.map(seat => ({
            type: "button",
            style: "primary",
            action: { type: "message", label: seat, text: seat },
            margin: "sm"
          }))
        ]
      }
    }
  };
}

// =============================
// LINE API
// =============================
async function replyMessage(replyToken, message) {
  const url = "https://api.line.me/v2/bot/message/reply";
  const body = JSON.stringify({ replyToken, messages: [message] });
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

async function getDisplayName(userId) {
  try {
    const res = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
      headers: { Authorization: `Bearer ${LINE_ACCESS_TOKEN}` },
    });
    if (!res.ok) return userId.slice(0, 6);
    const data = await res.json();
    return data.displayName || userId.slice(0, 6);
  } catch {
    return userId.slice(0, 6);
  }
}

// =============================
// 起動
// =============================
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});


