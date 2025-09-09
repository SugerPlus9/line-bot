// =============================
// LINE × Render 業務用Bot
// =============================

// 必要なライブラリ
import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";

// LINEのアクセストークンを環境変数から取得
const LINE_ACCESS_TOKEN = process.env.LINE_ACCESS_TOKEN;

// 固定の管理者グループID（ユーザーさんが教えてくれたID）
const ADMIN_GROUP_ID = "C913d1bb80352e75d7a89bb0ea871ee7";

// 席一覧（T1〜T6, V, V1〜V3）
const SEATS = ["T1", "T2", "T3", "T4", "T5", "T6", "V", "V1", "V2", "V3"];

// Expressサーバー
const app = express();
app.use(bodyParser.json());

// Webhookのエントリーポイント
app.post("/webhook", async (req, res) => {
  const events = req.body.events;
  if (!events || events.length === 0) {
    return res.sendStatus(200);
  }

  for (const event of events) {
    try {
      await handleEvent(event);
    } catch (err) {
      console.error("handleEvent error:", err);
    }
  }

  res.sendStatus(200);
});

// イベントを処理
async function handleEvent(event) {
  if (event.type !== "message") return;

  const msg = event.message;

  // ユーザーからのメッセージ
  if (event.source.type === "user") {
    if (msg.type === "text") {
      // 席名を選んだ場合
      if (SEATS.includes(msg.text)) {
        await replyMessage(event.replyToken, {
          type: "text",
          text: `【${msg.text}】オーダーを承りました。`,
        });
        // 管理グループへ転送
        await pushMessage(ADMIN_GROUP_ID, {
          type: "text",
          text: `[${msg.text}] ${event.source.userId} さんからオーダー`,
        });
      } else {
        // 席選択を促す
        await replyMessage(event.replyToken, {
          type: "text",
          text: "席を選んでください。",
          quickReply: {
            items: SEATS.map((seat) => ({
              type: "action",
              action: { type: "message", label: seat, text: seat },
            })),
          },
        });
      }
    }
  }
}

// LINEに返信
async function replyMessage(replyToken, message) {
  const url = "https://api.line.me/v2/bot/message/reply";
  const body = JSON.stringify({
    replyToken: replyToken,
    messages: [message],
  });
  await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LINE_ACCESS_TOKEN}`,
    },
    body: body,
  });
}

// LINEにプッシュ（管理グループへ転送）
async function pushMessage(to, message) {
  const url = "https://api.line.me/v2/bot/message/push";
  const body = JSON.stringify({
    to: to,
    messages: [message],
  });
  await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LINE_ACCESS_TOKEN}`,
    },
    body: body,
  });
}

// ポートで起動
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
