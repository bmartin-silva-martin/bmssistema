import { ImageResponse } from "next/og";

export const alt = "Icone de agenda para agendamento";
export const contentType = "image/png";
export const size = {
  height: 630,
  width: 1200,
};

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: "center",
          background: "linear-gradient(135deg, #0f172a 0%, #1f2937 46%, #ef6f45 100%)",
          color: "#ffffff",
          display: "flex",
          height: "100%",
          justifyContent: "center",
          padding: 72,
          width: "100%",
        }}
      >
        <div
          style={{
            alignItems: "center",
            background: "rgba(255,255,255,0.1)",
            border: "2px solid rgba(255,255,255,0.18)",
            borderRadius: 52,
            display: "flex",
            height: 360,
            justifyContent: "center",
            marginRight: 62,
            width: 360,
          }}
        >
          <div
            style={{
              alignItems: "center",
              border: "18px solid #ffffff",
              borderRadius: 38,
              display: "flex",
              flexDirection: "column",
              height: 230,
              justifyContent: "center",
              position: "relative",
              width: 230,
            }}
          >
            <div
              style={{
                background: "#ffffff",
                height: 18,
                left: 28,
                position: "absolute",
                top: 54,
                width: 174,
              }}
            />
            <div
              style={{
                background: "#ffffff",
                borderRadius: 999,
                height: 54,
                left: 38,
                position: "absolute",
                top: -42,
                width: 22,
              }}
            />
            <div
              style={{
                background: "#ffffff",
                borderRadius: 999,
                height: 54,
                position: "absolute",
                right: 38,
                top: -42,
                width: 22,
              }}
            />
            <div
              style={{
                alignItems: "center",
                border: "12px solid #ffffff",
                borderRadius: 999,
                bottom: -42,
                display: "flex",
                height: 94,
                justifyContent: "center",
                position: "absolute",
                right: -42,
                width: 94,
              }}
            >
              <div
                style={{
                  borderBottom: "10px solid #ffffff",
                  borderRight: "10px solid #ffffff",
                  height: 36,
                  transform: "rotate(45deg)",
                  width: 20,
                }}
              />
            </div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", width: 610 }}>
          <div style={{ fontSize: 78, fontWeight: 900, lineHeight: 1 }}>Agendamento</div>
          <div style={{ color: "#f8fafc", fontSize: 36, lineHeight: 1.25, marginTop: 26 }}>
            Realize seu agendamento agora mesmo, é rápido e fácil.
          </div>
          <div style={{ color: "#dbeafe", fontSize: 30, marginTop: 42 }}>BMS Sistema</div>
        </div>
      </div>
    ),
    size,
  );
}
