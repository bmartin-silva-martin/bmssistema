self.addEventListener("push", (event) => {
  let data = {
    body: "Voce tem um agendamento na barbearia. Confira o horario combinado.",
    tag: "bms-lembrete-agendamento",
    title: "Lembrete de agendamento",
    url: "/agendamentos",
  };

  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    // Mantem o texto padrao quando o payload nao for JSON valido.
  }

  const title = data.title || "Lembrete de agendamento";
  const options = {
    badge: "/favicon.ico",
    body: data.body || "Voce tem um agendamento na barbearia. Confira o horario combinado.",
    data: {
      url: data.url || "/agendamentos",
    },
    icon: "/favicon.ico",
    requireInteraction: true,
    tag: data.tag || "bms-lembrete-agendamento",
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const requestedUrl = event.notification.data?.url;
  let targetUrl = new URL("/agendamentos", self.location.origin);

  if (typeof requestedUrl === "string") {
    try {
      const parsedUrl = new URL(requestedUrl, self.location.origin);
      if (parsedUrl.origin === self.location.origin && parsedUrl.pathname.startsWith("/")) {
        targetUrl = parsedUrl;
      }
    } catch {
      // Usa a rota interna padrao quando a URL recebida for invalida.
    }
  }

  event.waitUntil(self.clients.openWindow(targetUrl.href));
});
