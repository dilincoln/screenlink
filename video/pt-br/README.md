# Vídeo de apresentação — pt-BR

Vídeo de ~2 min 22 s do ScreenLink feito com [HyperFrames](https://hyperframes.heygen.com) (HTML + GSAP
renderizado quadro a quadro). O render final fica em `renders/screenlink-pt-br.mp4`.

## Roteiro

| Tempo | Cena (`compositions/`) | O que acontece |
| --- | --- | --- |
| 0–18,2 s | `chat.html` | Chat dos amigos: "compartilha aí pra eu ver" → *indisponível na sua região* → foto da tela com o celular → bloqueou pra todo mundo |
| 18,2–24,0 s | `build.html` | "Calma e conta até 9." / "Respira." / "Tem outro jeito." / 3-2-1 |
| 24,0–35,6 s | `logo.html` | Refrão 1 da música: ScreenLink |
| 35,6–47,3 s | `step-room.html` | 1. Cria uma sala e manda o código |
| 47,3–58,9 s | `step-share.html` | 2. Escolhe o jogo (diálogo real de compartilhamento) |
| 58,9–63,1 s | `notify.html` | O popup "Lucas está compartilhando" chega na tela de seis amigos |
| 63,1–77,6 s | `watch.html` | 3. Bia clica em Assistir → a luta ao vivo: "DEMOCRACIA… RELATIVAAAAAA!!" × "DEFESAAA…. IMBROCHÁVEEEELLL!!!" → a explosão no refrão 2 (70,36 s) → DOUBLE K.O., todo mundo perdeu |
| 77,6–93,6 s | `relay.html` | Sem afetar sua internet: mesma lógica do torrent, quem assiste repassa pra poucos, até um limite; o refrão 3 entra em 91,07 s |
| 93,6–105,3 s | `slides.html` | Não é só jogo: os slides do TCC |
| 105,3–128,5 s | `features.html` | Um cartão por compasso com o que o app faz ("Sem cadastro" com "ninguém vai pegar meu telefone" / "pegaram meu telefone"), depois "Código aberto e auditável." com "…vai chorar a noite toda hoje" logo antes da risada |
| 128,5–141,5 s | `outro.html` | Onde baixar; a batida final da faixa em 138,72 s |

O jogo (`assets/js/game.js`, "Treta em Brasília") é uma paródia em pixel art: os dois soltam o
especial e ninguém ganha.

### Música

`assets/audio/music-edit.mp3` é a edição da faixa feita à mão pelo Diego: a introdução e o refrão 1
(o refrão 1 cai em 24,0 s, no logo), o refrão 2 a partir de 70,36 s e o refrão 3 a partir de 91,07 s
até o fim da faixa. Ela entra em `index.html` como um clipe só, 29 ms depois do início do vídeo, e
as cenas foram montadas em cima dela: a explosão da luta cai no refrão 2, o final da faixa no
`outro.html` e a batida final em 138,72 s. A faixa original inteira continua em
`assets/audio/music-powerup.mp3` (copiada por `mock/audio.sh`), para quem quiser refazer a edição.

Os memes ficam em `index.html` com high-pass, low-pass, reverb e volume baixo (`data-fx-chain`) e
a música abaixa um pouco sob cada um (`data-automation`): dá pra mexer em tudo isso no editor do
HyperFrames.

## Telas do app a partir de um banco de demonstração

As telas são o app de verdade (`client/ui`, `client/popup`), não mockups desenhados:

```sh
bun mock/seed.ts      # mock/screenlink-demo.sqlite: 15 usuários, 7 salas (schema do server/db.ts)
bun mock/capture.ts   # abre client/ui no Chrome headless com esse banco → assets/screens/*.png
```

- `mock/data.ts` — pessoas e salas; `mock/live.ts` — quem está online/ao vivo em cada cena (o
  servidor guarda isso em memória); `mock/state.ts` — monta o `state` que o `main.js` mandaria
  pra janela.
- O banco abre no servidor real: `DB_FILE=video/pt-br/mock/screenlink-demo.sqlite bun run server`.

## Áudio

```sh
bash mock/audio.sh <powerup.mp3> <pasta-dos-memes>   # copia a música, normaliza memes, gera SFX
```

Créditos em `LICENSES.txt`.

## Preview e render

```sh
npm install
npx hyperframes@0.8.226 preview                                           # editor no navegador
npx hyperframes@0.8.226 render --output renders/screenlink-pt-br.mp4
```

Para a versão em inglês, copie esta pasta para `video/en` e troque os textos das cenas.
