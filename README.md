# Sample Finder

Agregador de busca de **samples, loops e áudios gratuitos**: você digita o que procura e o app vasculha bibliotecas públicas em tempo real, com **preview de áudio e download direto** — a licença de cada som aparece no card.

## Fontes de busca

| Fonte | O que tem | Download | Configuração |
|---|---|---|---|
| **Internet Archive** | Samples, loops, packs e áudios CC0/Creative Commons | Direto | Nenhuma (funciona de cara) |
| **Looperman** | Loops de produtores (drums, bass, vocal...) com BPM/gênero | Direto | Nenhuma |
| **FreeSound** | One-shots e efeitos sonoros (CC) | Preview baixável direto no app (via proxy) | Opcional: `FSOUND_API_KEY` |
| **Loopmasters** | Packs **gratuitos** da loja (seção Free Samples) | Demo baixável direto no app; pack completo grátis via carrinho no site | Nenhuma |
| **SampleRadar** | Packs completos em WAV do MusicRadar (~285 packs, sem cadastro) | Zip baixado direto no app (via proxy) | Nenhuma |

## Catálogo de fontes (`/catalogo`)

Página separada com as **58 plataformas** de samples gratuitos (selos, portais e acervos): busca por nome/gênero e link direto para cada fonte. Quatro delas estão **integradas na busca** (Internet Archive, FreeSound, Looperman, Loopmasters, SampleRadar); as demais são catálogo de consulta — os freebies delas ficam no site oficial (cadastro/carrinho da própria empresa).

## Download universal

Regra do app: **todo áudio que o Sample Finder encontra e toca, baixa pela própria plataforma** — nenhum download exige acessar o site de origem. Isso vale para as cinco fontes integradas (previews do FreeSound, demos do Loopmasters e zips do SampleRadar incluídos, via `/proxy`). Plataformas que só liberam arquivos por carrinho/conta no site oficial (Cymatics, W.A. Production, Black Octopus etc.) ficam no catálogo com link direto — automatizar carrinhos de terceiros violaria os termos desses sites, e re-hospedar os arquivos violaria as licenças.

## Rodar localmente

```bash
npm install
npm start          # porta 3000 (ou defina PORT=3100 para outra porta)
```

Abra `http://localhost:3000` e busque, ex.: `drum loop`, `rain ambience`, `808 bass`.

## Filtros musicais (estilo Splice)

Acima dos resultados há filtros de **gênero**, **tom** (key), **BPM** (faixa mín./máx.) e **compasso** (time signature), carregados ao vivo de `/api/filters` (com cache de 30 min e fallback embutido).

Como cada filtro é aplicado:

- **Looperman** aplica os filtros na busca oficial do site (`gid`, `mkey`, `tsig`, `ftempo`/`ttempo`) — resultados já vêm filtrados do servidor, com tom e compasso extraídos da página de detalhe de cada loop.
- **Internet Archive / FreeSound** não têm metadados de tom/BPM/compasso na busca; o app aplica um filtro residual no que consegue extrair (ex.: BPM no título) e, quando o filtro de BPM/tom/compasso está ativo, **itens sem esse metadado ficam de fora** — como no Splice, o que aparece bate com o filtro escolhido.
- O gênero é conferido pelo nome do gênero no título/tag do item nas fontes sem busca por gênero.

O botão **Limpar filtros** zera tudo e refaz a busca.

### Ativar FreeSound (opcional)

1. Crie uma chave grátis em <https://freesound.org/apiv2/apply/>
2. Crie um arquivo `.env` a partir do `.env.example` com `FSOUND_API_KEY=sua_chave`
3. Reinicie o servidor

Sem a chave, as outras duas fontes continuam funcionando normalmente.

## Publicar no Render

1. Suba este repositório para o GitHub (`git init`, `git add .`, `git commit`, criar repo e `git push`).
   - O `.gitignore` já exclui `node_modules/` e `.env`.
2. No Render: **New → Web Service** → conecte o repositório.
3. Configuração do serviço:
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - A variável `PORT` é injetada pelo Render automaticamente.
4. (Opcional) Em *Environment*, adicione `FSOUND_API_KEY` para habilitar o FreeSound.

## Anti-hibernação (plano grátis do Render)

O plano grátis do Render adormece o serviço após ~15 min sem requisições. Para evitar isso, o próprio app faz um *keep-alive*: quando detecta que está rodando no Render (`RENDER_EXTERNAL_URL`), ele consulta `/api/health` pela URL pública a cada ~10 min (com variação aleatória), o que reseta o contador de inatividade — na prática, a instância não hiberna.

Limites honestos:

- É um mecanismo interno: se o processo reiniciar (deploy novo, queda), ele volta a funcionar sozinho.
- O Render pode mudar esse comportamento a qualquer momento; alternativa externa robusta é um monitor HTTP gratuito (ex.: UptimeRobot) pingando a URL a cada 5–10 min.
- Não há custo extra enquanto o plano for grátis.

## Estrutura

```
server.js                     # Express: /api/search + /proxy (streaming de áudio) + /catalogo
src/search.js                 # Orquestra as fontes, classifica e deduplica
src/sources/internetArchive.js # API pública do Internet Archive (sem chave)
src/sources/looperman.js      # Busca do Looperman via fluxo oficial do site (POST + CSRF)
src/sources/freesound.js      # API v2 do FreeSound (chave opcional)
src/sources/loopmasters.js    # Packs gratuitos do Loopmasters (seção Free Samples)
src/sources/sampleradar.js    # Packs WAV do MusicRadar/SampleRadar (zips diretos)
public/                       # Interface (HTML/CSS/JS puros, sem build) + catalogo.html
```

## Notas honestas sobre limites

- **Licenças**: cada resultado exibe a licença (CC0, CC BY, etc.). Verifique antes de usar em lançamentos comerciais — CC BY exige atribuição; CC BY-NC proíbe uso comercial.
- **Áudio via proxy local**: o preview e o download de todas as fontes passam por `/proxy` (whitelist: Looperman, FreeSound, Loopmasters, SampleRadar e Internet Archive — não é proxy aberto). Isso resolve duas limitações das fontes: proteção anti-hotlink do Looperman (exige `Referer` do próprio site) e os redirects/CDN do Internet Archive que quebram o player por CORS. O proxy repassa `Range` (seek no player) e o nome do arquivo no download.
- **Play exclusivo**: dar play em um resultado pausa automaticamente os outros.
- **FreeSound**: o preview toca e baixa direto no app; o arquivo completo exige login gratuito no próprio site.
- **Looperman**: os resultados vêm da busca oficial do site (mesmo fluxo que o navegador usa, incluindo token de sessão).
- **Loopmasters**: é uma loja paga — o app inclui apenas o catálogo **gratuito** (seção Free Samples, ~12 packs). O demo oficial toca e baixa no app; o pack completo grátis é liberado no site deles (carrinho + e-mail), então o card leva para a página do produto. Packs pagos nunca aparecem.
- **SampleRadar**: o hub do MusicRadar lista ~285 packs gratuitos; o app encontra o pack e baixa o zip direto do CDN deles, sem cadastro.
- **Catálogo de 58 plataformas**: as fontes com freebies fechados em cadastro/carrinho (Cymatics, W.A. Production, Black Octopus etc.) aparecem no catálogo com link para o site oficial — o app não automatiza carrinhos de terceiros nem re-hospeda arquivos (violaria ToS/licenças).
- **Disponibilidade**: se um site mudar o layout ou aplicar bloqueio anti-bot, o app degrada com elegância — exibe um aviso e entrega os resultados das outras fontes.
