# Social Agent — Guia rápido

## Para que serve
O **Social Agent** pega o conteúdo de uma **URL** (artigo, blog, página institucional, etc.) e ajuda você a **reutilizar** esse conteúdo para redes sociais, criando:

- Post para **LinkedIn**
- Post para **Instagram**
- Roteiro para **Reels**
- Roteiro para **TikTok**
- Roteiro para **YouTube**
- Roteiro para **Vídeo no LinkedIn**

A ferramenta é útil para:
- Transformar conteúdo longo em formatos curtos e publicáveis.
- Ganhar velocidade na criação de conteúdo sem “inventar fatos”.
- Padronizar tom e estrutura dos posts.

---

## O que ele faz (passo a passo)
1. Você informa uma **URL**.
2. O sistema extrai o texto principal da página.
3. Ele busca trechos relevantes (contexto) para evitar ruído e melhorar consistência.
4. Gera a resposta no **formato** escolhido (ex: LinkedIn, Reels).
5. Se você não gostar, você pode **refinar** a resposta sem precisar “começar do zero”.

---

## Campos (Configuração)

### URL do Conteúdo (obrigatório)
O link da página que será analisada.

**Dicas:**
- Use URLs públicas e acessíveis (sem login).
- Se a página tiver muito conteúdo dinâmico, o resultado pode variar.
- Se der erro, teste abrir a URL no navegador e confirme que ela carrega.

---

### Intenção (opcional)
Define **qual formato** você quer gerar.

Exemplos:
- **Post para LinkedIn** → título + bullets + pergunta final
- **Post para Instagram** → legenda curta + sugestão de imagem
- **Roteiro de vídeo** → gancho + desenvolvimento + CTA

**Se você não selecionar**, o agente pode retornar uma pergunta pedindo que você escolha o formato.

---

### Consulta Específica (opcional)
Um direcionamento do que você quer focar no conteúdo.

Exemplos:
- “resumir pontos chave”
- “focar em benefícios e casos de uso”
- “trazer 3 insights práticos”
- “evitar termos muito técnicos”

Quanto melhor a consulta, mais preciso e útil tende a ser o resultado.

---

### Tom (opcional)
Define estilo e linguagem.

Exemplos:
- “profissional e direto”
- “didático e simples”
- “criativo e provocativo”
- “bem informal”

---

## Refinar resposta
Depois que o agente gerar uma resposta, você pode usar o campo **Refinar resposta** para pedir ajustes, por exemplo:

- “Aumente o texto e deixe mais persuasivo”
- “Inclua um CTA mais forte no final”
- “Troque para um tom mais informal”
- “Adicione exemplos práticos”
- “Crie 2 versões: curta e longa”

**Como funciona:**
- O sistema usa sua instrução + a resposta anterior para produzir uma versão melhorada.
- Ele tenta evitar repetir exatamente o mesmo texto.

---

## Fontes
Ao final, podem aparecer **Fontes** com URLs relacionadas ao contexto utilizado.
Isso ajuda a conferir de onde vieram as informações.

---

## Boas práticas (recomendado)
- Comece com **Intenção + Tom** para reduzir retrabalho.
- Use **Consulta Específica** quando você já sabe o ângulo (ex: “pontos chave”, “passo a passo”, “erros comuns”).
- Se a resposta vier genérica, refine com:
  - “adicione exemplos”
  - “inclua números e detalhes (sem inventar)”
  - “traga estrutura com tópicos e CTA”

---

## Limitações
- O sistema tenta não inventar fatos, mas depende do conteúdo acessível na URL e do contexto recuperado.
- Páginas com paywall, bloqueios, ou conteúdo altamente dinâmico podem gerar extração incompleta.