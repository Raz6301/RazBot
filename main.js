const { Client, GatewayIntentBits, Partials, PermissionsBitField, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require("discord.js");
require("dotenv").config();
const { GiveawaysManager } = require("discord-giveaways");
const config = require("./config.json");
const setupDashboard = require("./dashboard");
const trackInvites = require("./invites");
const fs = require("fs");
const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const app = express();

// ניצור שרת HTTP נפרד עבור Express ונחבר את Socket.io
const server = http.createServer(app);
const io = new Server(server);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction]
});

client.giveawaysManager = new GiveawaysManager(client, {
  storage: './giveaways.json',
  default: {
    botsCanWin: false,
    embedColor: '#FF0000',
    reaction: '🎉'
  }
});

// --- Real‑time giveaways broadcasting ---
// Define a helper function to collect current giveaways and broadcast to all connected clients.
//
// Helper to broadcast giveaway state to all connected clients. In addition
// to sending the raw giveaway objects from discord‑giveaways, this helper
// resolves the names of any winners for ended giveaways so the dashboard can
// display them instead of just a count. If an error occurs while
// fetching user details, the username will be omitted from the list.
async function broadcastGiveaways() {
  try {
    const all = await client.giveawaysManager.getAllGiveaways();
    const active = all.filter(g => !g.ended);
    const ended = all.filter(g => g.ended);
    // For ended giveaways resolve the winner names using winnerIds from
    // discord‑giveaways. When no IDs are available we return an empty list.
    const endedWithNames = await Promise.all(ended.map(async g => {
      let winnerNames = [];
      if (Array.isArray(g.winnerIds) && g.winnerIds.length > 0) {
        const names = await Promise.all(g.winnerIds.map(async id => {
          try {
            const user = await client.users.fetch(id);
            return user ? user.username : null;
          } catch {
            return null;
          }
        }));
        winnerNames = names.filter(Boolean);
      }
      return { ...g, winnerNames };
    }));
    io.emit('giveaways', { active, ended: endedWithNames });
  } catch (err) {
    console.warn('⚠️ שגיאה בשידור עדכון הגרלות:', err);
  }
}

// Listen for all relevant giveaway lifecycle events and broadcast updates immediately.
['giveawayStarted', 'giveawayEnded', 'giveawayDeleted', 'giveawayRerolled', 'giveawayPaused', 'giveawayUnpaused', 'giveawayEdited']
  .forEach(evt => {
    client.giveawaysManager.on(evt, broadcastGiveaways);
  });

const ticketLogs = new Map();
const userTickets = new Map();

client.once("ready", async () => {
  console.log(`🤖 הבוט התחבר בתור ${client.user.tag}`);
  const guild = client.guilds.cache.first();
  if (!guild) return console.log("❌ לא נמצא שרת");

  // 🔁 עדכון סטטוס כל דקה
  setInterval(() => {
    const memberCount = guild.memberCount;
console.log("🔄 מעדכן סטטוס...");
client.user.setPresence({
  activities: [{ name: `👥 | ${memberCount}`, type: 2 }],
  status: "online"
});
  }, 60000);

setupDashboard(client, guild, app);
  // Setup ticket API routes (closed tickets)
  try {
    require('./tickets-api')(app);
  } catch (err) {
    console.warn('⚠️ לא ניתן לטעון ממשק API לטיקטים:', err);
  }
// העבר את אובייקט Socket.io למעקב ההזמנות כדי שנוכל לשדר עדכונים בזמן אמת
trackInvites(client, io);

  const ticketDir = path.join(__dirname, 'tickets');
  if (fs.existsSync(ticketDir)) {
    const files = fs.readdirSync(ticketDir);
    for (const file of files) {
      const filePath = path.join(ticketDir, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      const channelId = file.replace('.json', '');
      try {
        const messages = JSON.parse(content);
        ticketLogs.set(channelId, messages);
      } catch {
        console.log(`⚠️ שגיאה בקריאת קובץ טיקט ${file}`);
      }
    }
  }
});

client.on("guildMemberAdd", async member => {
  // השתמש בשם הרול מתוך הקונפיג במקום מחרוזת קשיחה
  const roleName = config.autoRoleName;
  const role = member.guild.roles.cache.find(r => r.name === roleName);
  if (role) {
    try {
      await member.roles.add(role);
      console.log(`✅ ניתן רול ${roleName} ל־${member.user.tag}`);
    } catch (err) {
      console.error(`❌ שגיאה בהוספת רול:`, err);
    }
  } else {
    console.warn(`⚠️ לא נמצא רול בשם "${roleName}"`);
  }
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;

  const guild = interaction.guild;
  const member = interaction.member;

  if (interaction.customId === "open_ticket") {
    const existingChannel = guild.channels.cache.find(
      c =>
        c.type === ChannelType.GuildText &&
        c.name.startsWith("❎│") &&
        c.permissionOverwrites.cache.has(member.id) &&
c.parent?.name !== "טיקטים סגורים"
    );

    if (existingChannel) {
      return interaction.reply({ content: "🕒 כבר יש לך טיקט פתוח כרגע. סגור אותו לפני פתיחת חדש.", ephemeral: true });
    }

    const now = Date.now();
    const lastOpened = userTickets.get(member.id);

if (lastOpened && now - lastOpened < 5 * 60 * 1000) {
  return interaction.reply({ content: "🕒 ניתן לפתוח טיקט חדש רק 5 דקות לאחר סגירת הקודם.", ephemeral: true });
}


    userTickets.set(member.id, now);

    // חיפוש הקטגוריה לפתיחת טיקטים לפי שם בקובץ הקונפיג
    const category = guild.channels.cache.find(
      c => c.name === config.ticketCategoryName && c.type === ChannelType.GuildCategory
    );
    const channelName = `❎│${member.user.username}`;

    const ticketChannel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: category?.id || null,
      permissionOverwrites: [
        {
          id: guild.id,
          deny: [PermissionsBitField.Flags.ViewChannel]
        },
        {
          id: member.id,
          allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages]
        },
        ...guild.roles.cache.filter(r => r.permissions.has(PermissionsBitField.Flags.Administrator)).map(r => ({
          id: r.id,
          allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages]
        }))
      ]
    });

    const closeBtn = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("close_ticket")
        .setLabel("🔒 סגור טיקט")
        .setStyle(ButtonStyle.Danger)
    );

    await ticketChannel.send({ content: "📩 טיקט נפתח. צוות השרת יענה לך בקרוב.", components: [closeBtn] });
    await interaction.reply({ content: "הטיקט נפתח בהצלחה!", ephemeral: true });

    ticketLogs.set(ticketChannel.id, []);
  }

if (interaction.customId === "close_ticket") {
  // ✅ רק למי שיש ManageMessages (לרוב – צוות)
  if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
    return interaction.reply({ content: "❌ רק צוות השרת יכול לסגור טיקט.", ephemeral: true });
  }

  const reasonMenu = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("select_close_reason")
      .setPlaceholder("בחר סיבה לסגירת הטיקט")
      .addOptions([
        new StringSelectMenuOptionBuilder().setLabel("טופל בהצלחה").setValue("טופל בהצלחה"),
        new StringSelectMenuOptionBuilder().setLabel("כפול / טעות").setValue("כפול / טעות"),
        new StringSelectMenuOptionBuilder().setLabel("לא רלוונטי").setValue("לא רלוונטי")
      ])
  );

  await interaction.reply({ content: "📝 בחר סיבה לסגירת הטיקט:", components: [reasonMenu], ephemeral: true });
}


  if (interaction.customId === "select_close_reason") {
    const reason = interaction.values[0];
    await interaction.deferUpdate();

    await interaction.channel.send(`🔒 הטיקט נסגר על ידי ${interaction.user} | סיבה: ${reason}`);

    // קרא שם קטגוריה סגורה מתוך קובץ קונפיג, עם אפשרות לעקיפה באמצעות closedCategory.txt
    let closedCategoryName = config.closedTicketsCategoryName;
    try {
      const filePath = path.join(__dirname, "closedCategory.txt");
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, "utf-8").trim();
        if (content) closedCategoryName = content;
      }
    } catch (err) {
      console.warn("⚠️ שגיאה בקריאת קובץ קטגוריה:", err);
    }

    let hiddenCategory = interaction.guild.channels.cache.find(
      c => c.name === closedCategoryName && c.type === ChannelType.GuildCategory
    );

    if (!hiddenCategory) {
      hiddenCategory = await interaction.guild.channels.create({
        name: closedCategoryName,
        type: ChannelType.GuildCategory
      });
    }

    if (hiddenCategory) {
      await interaction.channel.setParent(hiddenCategory.id);
    }

    await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
      SendMessages: false,
      ViewChannel: false
    });

    const log = ticketLogs.get(interaction.channel.id) || [];
    const dir = path.join(__dirname, 'tickets');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    fs.writeFileSync(`${dir}/${interaction.channel.id}.json`, JSON.stringify(log, null, 2));
  }
});

client.on("messageCreate", async message => {
  if (message.author.bot) return;

  const hasBadWord = config.forbiddenWords.some(word =>
    message.content.toLowerCase().includes(word.toLowerCase())
  );

  const hasLink = config.blockLinks && /(https?:\/\/|discord\.gg)/i.test(message.content);

  if (hasBadWord || hasLink) {
    await message.delete().catch(() => {});

    try {
      const warningMsg = await message.channel.send({
        content: `${message.author} 🚫 ההודעה שלך נמחקה כי היא כללה תוכן אסור או קישור.`,
      });
      setTimeout(() => warningMsg.delete().catch(() => {}), 5000);
    } catch {
      console.log(`❗ שגיאה במחיקת ההודעה או בשליחת האזהרה.`);
    }
  }

  if (message.channel.name?.startsWith("❎│")) {
    const existingLog = ticketLogs.get(message.channel.id) || [];
    existingLog.push({ user: message.author.tag, content: message.content });
    ticketLogs.set(message.channel.id, existingLog);
  }
});

// קבע פורט דינמי דרך משתנה סביבה או באמצעות הגדרה בקובץ הקונפיג
const PORT = process.env.PORT || config.port || 3000;
// שלח עדכוני סטטיסטיקות והגרלות ללקוחות מחוברים כל 10 שניות
setInterval(async () => {
  const guildInstance = client.guilds.cache.first();
  if (guildInstance) {
    const stats = {
      users: guildInstance.memberCount,
      channels: guildInstance.channels.cache.size,
      roles: guildInstance.roles.cache.size
    };
    io.emit('stats', stats);
  }
  // שלח גם עדכוני הגרלות בזמן אמת (כולל שמות הזוכים)
  await broadcastGiveaways();
}, 10000);

// האזן לחיבורי Socket.io ושלח נתונים ראשוניים ללקוח
io.on('connection', async socket => {
  // שלח נתוני סטטיסטיקות ראשוניים
  const guildInstance = client.guilds.cache.first();
  if (guildInstance) {
    const stats = {
      users: guildInstance.memberCount,
      channels: guildInstance.channels.cache.size,
      roles: guildInstance.roles.cache.size
    };
    socket.emit('stats', stats);
  }
  // שלח נתוני הגרלות ראשוניים כולל שמות הזוכים
  try {
    const all = await client.giveawaysManager.getAllGiveaways();
    const active = all.filter(g => !g.ended);
    const ended = all.filter(g => g.ended);
    const endedWithNames = await Promise.all(ended.map(async g => {
      let winnerNames = [];
      if (Array.isArray(g.winnerIds) && g.winnerIds.length > 0) {
        const names = await Promise.all(g.winnerIds.map(async id => {
          try {
            const user = await client.users.fetch(id);
            return user ? user.username : null;
          } catch {
            return null;
          }
        }));
        winnerNames = names.filter(Boolean);
      }
      return { ...g, winnerNames };
    }));
    socket.emit('giveaways', { active, ended: endedWithNames });
  } catch (err) {
    console.warn('⚠️ שגיאה בקריאת נתוני הגרלות:', err);
  }
  // שליחת נתוני הזמנות ראשוניים
  try {
    const invitesData = require('./invites.json');
    const formatted = await Promise.all(
      Object.entries(invitesData).map(async ([userId, data]) => {
        let username = 'Unknown';
        try {
          const user = await client.users.fetch(userId);
          if (user) username = user.tag;
        } catch {}
        return {
          userId,
          username,
          count: data.count,
          invited: data.invited || []
        };
      })
    );
    socket.emit('invites', formatted);
  } catch (err) {
    console.warn('⚠️ שגיאה בשליחת הזמנות:', err);
  }
});

// הפעל את השרת המשלב Express ו-Socket.io
server.listen(PORT, () => {
  console.log(`🌐 לוח הבקרה זמין בכתובת http://localhost:${PORT}`);
});

client.login(process.env.TOKEN);
