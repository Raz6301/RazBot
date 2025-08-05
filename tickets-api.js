const path = require("path");
const fs = require("fs");

module.exports = function setupTicketApi(app) {
  app.get("/api/tickets", (req, res) => {
    const ticketLogsDir = path.join(__dirname, "tickets");
    let ticketLogs = [];

    if (fs.existsSync(ticketLogsDir)) {
      ticketLogs = fs.readdirSync(ticketLogsDir)
        .filter(file => file.endsWith(".json"))
        .map(filename => {
          const raw = fs.readFileSync(path.join(ticketLogsDir, filename), "utf-8");
          const messagesArray = JSON.parse(raw);
          const name = filename.replace(".json", "");
          const [user, channel] = name.split("-");
          const messages = messagesArray.map(msg => `${msg.user || msg.author}: ${msg.content}`).join("\n");
          return {
            name,
            user: user || "לא ידוע",
            channel: channel || "לא ידוע",
            messages
          };
        });
    }

    res.json(ticketLogs);
  });
};
