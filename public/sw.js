self.addEventListener("push", (event) => {
  const title = "Lembrete de agendamento";
  const options = {
    badge: "/favicon.ico",
    body: "Voce tem um agendamento na barbearia. Confira o horario combinado.",
    icon: "/favicon.ico",
    tag: "bms-lembrete-agendamento",
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow("/agendamentos"));
});
