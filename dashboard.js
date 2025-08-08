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

  /**
   * Middleware לאימות גישה ללוח הבקרה.
   * אם מוגדר במשתנה הסביבה ADMIN_PASSWORD, יידרש להיכנס באמצעותו. אחרת, הגישה פתוחה.
   * מתיר גישה לעמוד ההתחברות ולקבצי סטטיים.
   */
  app.use((req, res, next) => {
    const adminPass = process.env.ADMIN_PASSWORD;
    // אם לא הוגדרה סיסמה – אין צורך באימות
    if (!adminPass) return next();

    // מתן גישה חופשית לקבצי סטטיים (css, js, תמונות) ועמוד התחברות
    if (req.path.startsWith('/public') || req.path === '/login' || req.path === '/logout') {
      return next();
    }

    // פונקציה קטנה לפירוק עוגיות
    const cookies = {};
    const cookieHeader = req.headers.cookie;
    if (cookieHeader) {
      cookieHeader.split(';').forEach(pair => {
        const [key, value] = pair.trim().split('=');
        cookies[key] = decodeURIComponent(value);
      });
    }
    if (cookies.admin && cookies.admin === adminPass) {
      return next();
    }
    return res.redirect('/login');
  });

  // עמוד התחברות
  app.get('/login', (req, res) => {
    const error = req.query.error === '1';
    // ניתן לבחור שפה באמצעות פרמטר lang
    const lang = req.query.lang || 'he';
    const translations = {
      he: {
        loginTitle: 'התחברות למנהל',
        passwordPlaceholder: 'סיסמת מנהל',
        loginButton: 'התחבר',
        errorMessage: 'סיסמה שגויה'
      },
      en: {
        loginTitle: 'Admin Login',
        passwordPlaceholder: 'Admin password',
        loginButton: 'Login',
        errorMessage: 'Incorrect password'
      }
    };
    const t = translations[lang] || translations.he;
    res.render('login', { t, lang, error });
  });

  app.post('/login', (req, res) => {
    const password = req.body.password;
    const adminPass = process.env.ADMIN_PASSWORD;
    const lang = req.query.lang || 'he';
    if (adminPass && password === adminPass) {
      // קבע עוגייה עם הסיסמה (פשוטה אך מספיקה להדגמה). העוגייה תימחק בדפדפן בעת סגירה.
      res.cookie('admin', adminPass, { httpOnly: true, sameSite: 'lax' });
      return res.redirect('/?lang=' + lang);
    }
    // במקרה של כשל – נציג הודעת שגיאה
    return res.redirect('/login?error=1&lang=' + lang);
  });

  app.get('/logout', (req, res) => {
    res.clearCookie('admin');
    const lang = req.query.lang || 'he';
    res.redirect('/login?lang=' + lang);
  });

  app.get("/", async (req, res) => {
    const stats = {
      users: guild.memberCount,
      channels: guild.channels.cache.size,
      roles: guild.roles.cache.size
    };

    const giveaways = await client.giveawaysManager.getAllGiveaways();

    // ברכות בסיסיות (ניתן להרחיב בעתיד למולטילינגואליות מלאה)
    const messages = {
      welcome: "ברוך הבא לשרת!",
      invite: "הוזמנת על ידי חבר!",
      error: "אירעה שגיאה, אנא נסה שוב."
    };

    // בחירת שפה (ברירת מחדל עברית)
    const lang = req.query.lang || 'he';
    const translations = {
      he: {
        menu: {
          stats: '📊 סטטיסטיקות',
          giveaways: '🎁 הגרלות',
          messages: '💬 הודעות',
          filters: '❌ סינון',
          ticket: '🎟️ טיקטים',
          invites: '📨 הזמנות'
        },
        sections: {
          statsTitle: '📊 סטטיסטיקות',
          createGiveawayTitle: '🎁 יצירת הגרלה חדשה',
          activeGiveawaysTitle: '🎉 הגרלות פעילות',
          endedGiveawaysTitle: '🕑 הגרלות שהסתיימו',
          messagesTitle: '💬 ניהול הודעות',
          filtersTitle: '❌ סינון מילים / קישורים',
          ticketTitle: '🎟️ שליחת טיקט',
          invitesTitle: '📨 הזמנות'
        },
        actions: {
          startGiveaway: '🚀 התחל הגרלה',
          addForbiddenWord: '➕ הוסף',
          sendTicket: '📩 שלח'
        }
      },
      en: {
        menu: {
          stats: '📊 Stats',
          giveaways: '🎁 Giveaways',
          messages: '💬 Messages',
          filters: '❌ Filters',
          ticket: '🎟️ Tickets',
          invites: '📨 Invites'
        },
        sections: {
          statsTitle: '📊 Statistics',
          createGiveawayTitle: '🎁 Create new giveaway',
          activeGiveawaysTitle: '🎉 Active giveaways',
          endedGiveawaysTitle: '🕑 Ended giveaways',
          messagesTitle: '💬 Manage messages',
          filtersTitle: '❌ Word / link filtering',
          ticketTitle: '🎟️ Send ticket',
          invitesTitle: '📨 Invites'
        },
        actions: {
          startGiveaway: '🚀 Start giveaway',
          addForbiddenWord: '➕ Add',
          sendTicket: '📩 Send'
        }
      }
    };
    const t = translations[lang] || translations.he;
    res.render("index", { stats, giveaways, messages, config, t, lang });
  });

  // החזר נתוני סטטיסטיקה בצורת JSON לצורך תצוגה דינמית בדשבורד
  app.get("/api/stats", (req, res) => {
    const stats = {
      users: guild.memberCount,
      channels: guild.channels.cache.size,
      roles: guild.roles.cache.size
    };
    res.json(stats);
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
    const lang = req.query.lang || 'he';
    config.blockLinks = !config.blockLinks;
    fs.writeFileSync("./config.json", JSON.stringify(config, null, 2));
    res.redirect("/?lang=" + lang);
  });

  app.post("/toggle-blockPings", (req, res) => {
    const lang = req.query.lang || 'he';
    config.blockPings = !config.blockPings;
    fs.writeFileSync("./config.json", JSON.stringify(config, null, 2));
    res.redirect("/?lang=" + lang);
  });

  app.post("/add-badword", (req, res) => {
    const lang = req.query.lang || 'he';
    const word = req.body.word?.trim();
    if (word && !config.forbiddenWords.includes(word)) {
      config.forbiddenWords.push(word);
      fs.writeFileSync("./config.json", JSON.stringify(config, null, 2));
    }
    res.redirect("/?lang=" + lang);
  });

app.post("/send-ticket-button", async (req, res) => {
  const lang = req.query.lang || 'he';
  const channelName = req.body.ticketChannel?.trim();

  // פה מוסיפים את ההמרה לירידת שורה
  const messageText = req.body.ticketMessage?.trim().replace(/\\n/g, '\n').replace(/<br>/g, '\n');
  const closedCategory = req.body.closedCategory?.trim(); // 👈 נוספה קריאה לשם הקטגוריה
  const channel = guild.channels.cache.find(c => c.name === channelName);
  if (!channel || !messageText) return res.redirect("/?lang=" + lang);

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
  res.redirect("/?lang=" + lang);
});


  app.post("/start-giveaway", async (req, res) => {
    const lang = req.query.lang || 'he';
    const channelName = req.body.giveawayChannel?.trim();
    const durationStr = req.body.giveawayDuration?.trim();
    const winnerCount = parseInt(req.body.giveawayWinners);
    const prize = req.body.giveawayPrize?.trim();
    const channel = guild.channels.cache.find(c => c.name === channelName);

    if (!channel || !durationStr || !winnerCount || !prize) return res.redirect("/?lang=" + lang);

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
    const lang = req.query.lang || 'he';
    client.giveawaysManager.end(giveaway.messageId)
      .then(() => res.redirect("/#giveaways?lang=" + lang))
      .catch(() => res.send("שגיאה בסיום ההגרלה"));
  });

  app.post("/reroll-giveaway/:id", async (req, res) => {
    const giveaway = client.giveawaysManager.giveaways.find(g => g.messageId === req.params.id);
    if (!giveaway) return res.send("לא נמצאה הגרלה");
    const lang = req.query.lang || 'he';
    client.giveawaysManager.reroll(giveaway.messageId)
      .then(() => res.redirect("/#giveaways?lang=" + lang))
      .catch(() => res.send("שגיאה ברירול"));
  });

  app.post("/delete-giveaway", async (req, res) => {
    const giveawayId = req.body.giveawayId?.trim();
    const giveaway = client.giveawaysManager.giveaways.find(g => g.messageId === giveawayId);
    if (giveaway) await client.giveawaysManager.delete(giveaway.messageId);
    const lang = req.query.lang || 'he';
    res.redirect("/#giveaways?lang=" + lang);
  });

  // app.listen הוסר – מנוהל דרך main.js
  };

module.exports = setupDashboard;
