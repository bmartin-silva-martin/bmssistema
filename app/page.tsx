import { supabase } from "@/lib/supabase";

export default async function Home() {
  const { data: empresas } = await supabase.from("empresas").select("*");
  const { data: servicos } = await supabase.from("servicos").select("*");
  const { data: agendamentos } = await supabase.from("agendamentos").select("*");

  return (
    <main
      style={{
        padding: 40,
        background: "#111",
        minHeight: "100vh",
        color: "white",
        fontFamily: "Arial",
      }}
    >
      <h1 style={{ fontSize: 40 }}>BMS Sistema</h1>

      <p style={{ opacity: 0.7 }}>
        Dashboard SaaS conectado ao Supabase
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3,1fr)",
          gap: 20,
          marginTop: 40,
        }}
      >
        <div
          style={{
            background: "#1f1f1f",
            padding: 20,
            borderRadius: 12,
          }}
        >
          <h2>Empresas</h2>
          <h1>{empresas?.length}</h1>
        </div>

        <div
          style={{
            background: "#1f1f1f",
            padding: 20,
            borderRadius: 12,
          }}
        >
          <h2>Serviços</h2>
          <h1>{servicos?.length}</h1>
        </div>

        <div
          style={{
            background: "#1f1f1f",
            padding: 20,
            borderRadius: 12,
          }}
        >
          <h2>Agendamentos</h2>
          <h1>{agendamentos?.length}</h1>
        </div>
      </div>

      <div
        style={{
          marginTop: 40,
          background: "#1f1f1f",
          padding: 20,
          borderRadius: 12,
        }}
      >
        <h2>Empresas cadastradas</h2>

        {empresas?.map((empresa) => (
          <div
            key={empresa.id}
            style={{
              padding: 15,
              borderBottom: "1px solid #333",
            }}
          >
            <h3>{empresa.nome}</h3>

            <p>Plano: {empresa.plano}</p>

            <p>Status: {empresa.ativo ? "Ativo" : "Inativo"}</p>
          </div>
        ))}
      </div>
    </main>
  );
}