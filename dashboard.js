// dashboard.js
const express = require("express");
const path = require("path");
const fs = require("fs");
const ms = require("ms");
const config = require("./config.json");

function setupDashboard(client, guild, app) {
    app.set("view engine", "ejs");
  app.set("views", path.join(__dirname, "views"));
  app.use(express.static(path.join(__dirname, "public")));
  app.use(express.urlencoded({ extended: true }));

  app.get("/", async (req, res) => {
    const stats = {
      users: guild.memberCount,
      channels: guild.channels.cache.size,
      roles: guild.roles.cache.size
    };

    const giveaways = await client.giveawaysManager.getAllGiveaways();

    const messages = {
      welcome: "ברוך הבא לשרת!",
      invite: "הוזמנת על ידי חבר!",
      error: "אירעה שגיאה, אנא נסה שוב."
    };

    res.render("index", { stats, giveaways, messages, config });
  });

app.get("/api/invites", async (req, res) => {
  const invitesData = require("./invites.json");
  const formatted = await Promise.all(
    Object.entries(invitesData).map(async ([userId, data]) => {
      let username = "לא ידוע";
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
  res.json(formatted);
});


  app.post("/toggle-blockLinks", (req, res) => {
    config.blockLinks = !config.blockLinks;
    fs.writeFileSync("./config.json", JSON.stringify(config, null, 2));
    res.redirect("/");
  });

  app.post("/toggle-blockPings", (req, res) => {
    config.blockPings = !config.blockPings;
    fs.writeFileSync("./config.json", JSON.stringify(config, null, 2));
    res.redirect("/");
  });

  app.post("/add-badword", (req, res) => {
    const word = req.body.word?.trim();
    if (word && !config.forbiddenWords.includes(word)) {
      config.forbiddenWords.push(word);
      fs.writeFileSync("./config.json", JSON.stringify(config, null, 2));
    }
    res.redirect("/");
  });

app.post("/send-ticket-button", async (req, res) => {
  const channelName = req.body.ticketChannel?.trim();

  // פה מוסיפים את ההמרה לירידת שורה
  const messageText = req.body.ticketMessage?.trim().replace(/\\n/g, '\n').replace(/<br>/g, '\n');
  const closedCategory = req.body.closedCategory?.trim(); // 👈 נוספה קריאה לשם הקטגוריה
  const channel = guild.channels.cache.find(c => c.name === channelName);
  if (!channel || !messageText) return res.redirect("/");

  // שמור את שם הקטגוריה לקובץ
  if (closedCategory) {
    const fs = require("fs");
    fs.writeFileSync("./closedCategory.txt", closedCategory);
  }

  const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

  const embed = new EmbedBuilder()
    .setTitle("פתח טיקט 📩")
    .setDescription(messageText)
    .setColor(0x5865F2)
    .setFooter({ text: "Powered by RazBot", iconURL: client.user.displayAvatarURL() });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("open_ticket")
      .setLabel("📩 פתח טיקט")
      .setStyle(ButtonStyle.Primary)
  );

  await channel.send({ embeds: [embed], components: [row] });
  res.redirect("/");
});


  app.post("/start-giveaway", async (req, res) => {
    const channelName = req.body.giveawayChannel?.trim();
    const durationStr = req.body.giveawayDuration?.trim();
    const winnerCount = parseInt(req.body.giveawayWinners);
    const prize = req.body.giveawayPrize?.trim();
    const channel = guild.channels.cache.find(c => c.name === channelName);

    if (!channel || !durationStr || !winnerCount || !prize) return res.redirect("/");

    const duration = ms(durationStr);
    const now = Date.now();
    const endTime = new Date(now + duration);

    const getHebrewDuration = (msValue) => {
      const seconds = Math.floor(msValue / 1000);
      if (seconds < 60) return `${seconds} שניות`;
      if (seconds < 3600) return `${Math.floor(seconds / 60)} דקות`;
      if (seconds < 86400) return `${Math.floor(seconds / 3600)} שעות`;
      return `${Math.floor(seconds / 86400)} ימים`;
    };

    client.giveawaysManager.start(channel, {
      duration,
      prize,
      winnerCount,
      hostedBy: null,
      messages: {
        giveaway: "🎉🎉 **הגרלה!** 🎉🎉",
        giveawayEnded: "🎉🎉 **ההגרלה הסתיימה** 🎉🎉",
        drawing: `ההגרלה מסתיימת בעוד: ${getHebrewDuration(duration)}`,
        inviteToParticipate: "הגב עם 🎉 כדי להשתתף!",
        winMessage: "🎉 מזל טוב {winners}, זכיתם ב**{this.prize}**!",
        embedFooter: "RazBot - הגרלות",
        noWinner: "ההגרלה בוטלה כי אף אחד לא השתתף 😢",
        winners: "זוכים",
        endedAt: "הסתיימה ב"
      }
    });

    res.redirect("/#giveaways");
  });

  app.get("/api/giveaways", async (req, res) => {
    const giveaways = await client.giveawaysManager.getAllGiveaways();
    res.json(giveaways);
  });

  app.post("/end-giveaway/:id", async (req, res) => {
    const giveaway = client.giveawaysManager.giveaways.find(g => g.messageId === req.params.id);
    if (!giveaway) return res.send("לא נמצאה הגרלה");

    client.giveawaysManager.end(giveaway.messageId)
      .then(() => res.redirect("/#giveaways"))
      .catch(() => res.send("שגיאה בסיום ההגרלה"));
  });

  app.post("/reroll-giveaway/:id", async (req, res) => {
    const giveaway = client.giveawaysManager.giveaways.find(g => g.messageId === req.params.id);
    if (!giveaway) return res.send("לא נמצאה הגרלה");

    client.giveawaysManager.reroll(giveaway.messageId)
      .then(() => res.redirect("/#giveaways"))
      .catch(() => res.send("שגיאה ברירול"));
  });

  app.post("/delete-giveaway", async (req, res) => {
    const giveawayId = req.body.giveawayId?.trim();
    const giveaway = client.giveawaysManager.giveaways.find(g => g.messageId === giveawayId);
    if (giveaway) await client.giveawaysManager.delete(giveaway.messageId);
    res.redirect("/#giveaways");
  });

  // app.listen הוסר – מנוהל דרך main.js
  };

module.exports = setupDashboard;
