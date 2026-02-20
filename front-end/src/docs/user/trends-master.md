# Trends Master — Guia rápido

## Para que serve
O **Trends Master** automatiza a coleta de **tendências (Google Trends)** e **notícias (Google News)**, gera um **relatório** e pode enviar por **email**.

Ele é ideal para:
- Monitorar rapidamente o que está em alta em um setor (ex: Autos, Tecnologia, Varejo).
- Identificar **assuntos quentes** + **notícias relacionadas** para pauta, conteúdo, marketing e BI.
- Receber um relatório recorrente por email (opcional).

---

## O que ele faz (passo a passo)
1. Coleta tendências relacionadas ao **Setor** e/ou aos **Tópicos personalizados**.
2. Para cada tendência (keyword), busca notícias relacionadas no Google News.
3. Usa IA para:
   - validar relevância de alguns termos (quando necessário)
   - resumir notícias
   - gerar um **Resumo Geral** (riscos, oportunidades, sinais de mercado)
4. Monta o relatório final e (opcionalmente) envia por email.

---

## Campos da automação

### Setor
Tema principal monitorado (ex: **Autos**, **Tecnologia**, **Varejo**).
É usado como base para coletar tendências e orientar o resumo final.

**Dica:** use termos simples e diretos. Ex: “Autos”, “Fintech”, “Logística”.

---

### Períodos (Diário / Semanal / Mensal)
Define a janela de tempo do monitoramento:

- **Diário:** foco em assuntos do dia (sinais rápidos, mais volátil)
- **Semanal:** foco em temas da semana (equilíbrio entre ruído e relevância)
- **Mensal:** foco em temas do mês (tendências mais estáveis)

---

### Mais populares
Quantidade de tendências do tipo **Mais populares** (equivalente ao “top”) a coletar por período.

- Aumentar este valor tende a trazer temas mais estáveis e recorrentes.
- Também aumenta o volume de keywords e de notícias coletadas.

---

### Em crescimento
Quantidade de tendências do tipo **Em crescimento** (equivalente ao “rising”) a coletar por período.

- Aumentar este valor tende a trazer temas novos e emergentes.
- Pode aumentar o “ruído” (temas menos relevantes para o setor).

---

### Artigos
Quantidade máxima de notícias buscadas **por keyword**.

Exemplo:
- Se você tiver 10 keywords e `Artigos = 3`, você pode coletar até ~30 notícias (antes de deduplicações/limites).

**Dica:** para rodar mais rápido, reduza este campo primeiro.

---

### Tópicos personalizados
Lista de temas que você quer **forçar** na análise (um por linha).

Como funciona:
- Quando preenchido, os tópicos personalizados têm prioridade na coleta (servem como base para tendências).
- Eles também entram na busca de notícias.
- Se houver notícias, o relatório pode incluir um bloco adicional “Tópicos Personalizados”.

Quando usar:
- Para monitorar temas específicos como marca, produto, concorrentes, tecnologias, eventos.

**Exemplos (um por linha):**
- OpenAI  
- BYD  
- seguro auto  
- carro elétrico  

---

## Email

### Enviar relatório por email
Se habilitado, o sistema envia o relatório ao final da execução.

Requisitos:
- SMTP configurado no servidor (variáveis no `.env`).

---

### Destinatários
Lista de emails (um por linha) que receberão o relatório.

**Dica:** comece com seu email para validar o envio antes de incluir mais pessoas.

---

### Modo
No nosso projeto, use **smtp**.

---

## Botões

### Salvar Config
Salva a configuração atual para reutilizar depois (persistida no banco).

### Executar
Executa a pipeline completa e gera o relatório (e envia email, se ativado).

### Recarregar
Carrega a configuração salva e preenche o formulário.

---

## Dicas de uso (recomendado)
Para começar com bom custo/tempo:
- **Mais populares:** 5  
- **Em crescimento:** 5  
- **Artigos:** 2–3  

Se o relatório vier muito amplo:
- reduza “Artigos” e/ou use “Tópicos personalizados” para focar.

Se o relatório vier muito “fraco”:
- aumente “Mais populares” e “Em crescimento”
- adicione tópicos personalizados para garantir assuntos relevantes