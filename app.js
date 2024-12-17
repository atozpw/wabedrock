import "dotenv/config";

import WhatsAppWebJS from "whatsapp-web.js";
import QrCode from "qrcode-terminal";
import MySQL from "mysql2/promise";
import axios from "axios";

const { Client, LocalAuth } = WhatsAppWebJS;

const APP_NAME = process.env.APP_NAME;
const CLIENT_ID = process.env.CLIENT_ID;
const ENDPOINT_BEDROCK = process.env.ENDPOINT_BEDROCK;

const client = new Client({
  authStrategy: new LocalAuth({
    clientId: CLIENT_ID,
  }),
  puppeteer: {
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--single-process",
      "--disable-gpu",
    ],
  },
});

const connection = async () => {
  return await MySQL.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
  });
};

const startSession = async (from) => {
  const db = await connection();
  const query = "INSERT INTO `sessions` (`from`, `expired_at`) VALUES (?, UNIX_TIMESTAMP() + 1800)";
  await db.execute(query, [from]);
  await db.end();
};

const endSession = async (from) => {
  const db = await connection();
  const query = "UPDATE `sessions` SET `expired_at` = UNIX_TIMESTAMP() WHERE `from` = ? AND `expired_at` > UNIX_TIMESTAMP()";
  await db.execute(query, [from]);
  await db.end();
};

const getSession = async (from) => {
  const db = await connection();
  const query = "SELECT `id` FROM `sessions` WHERE `from` = ? AND `expired_at` > UNIX_TIMESTAMP() ORDER BY `expired_at` DESC LIMIT 1";
  const [rows] = await db.query(query, [from]);
  await db.end();
  return rows[0] || false;
};

const getAnswer = async (ask) => {
  const response = await axios.post(ENDPOINT_BEDROCK + "/chatbot", { query: ask });
  return response.data.answer || response.data.error;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

client.once("ready", async () => {
  console.log(`${APP_NAME} with client ${CLIENT_ID} is ready!`);
});

client.on("qr", (qr) => {
  QrCode.generate(qr, { small: true });
});

client.on("message", async (message) => {
  const session = await getSession(message.from);
  if (message.body == "!start.ai") {
    const chat = await message.getChat();
    chat.sendStateTyping();
    await startSession(message.from);
    await sleep(2000);
    chat.clearState();
    client.sendMessage(message.from, "Halo");
  } else if (message.body == "!end.ai") {
    const chat = await message.getChat();
    chat.sendStateTyping();
    await endSession(message.from);
    await sleep(2000);
    chat.clearState();
    client.sendMessage(message.from, "Bye");
  } else if (session) {
    const chat = await message.getChat();
    chat.sendStateTyping();
    const answer = await getAnswer(message.body);
    chat.clearState();
    client.sendMessage(message.from, answer);
  }
});

client.initialize();
