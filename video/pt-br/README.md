# Vídeo de apresentação — pt-BR

Vídeo de ~67 s do ScreenLink feito com [HyperFrames](https://hyperframes.heygen.com) (HTML + GSAP
renderizado quadro a quadro). O render final fica em `renders/screenlink-pt-br.mp4`.

## Roteiro

| Tempo | Cena (`compositions/`) | O que acontece |
| --- | --- | --- |
| 0–17,3 s | `chat.html` | Chat dos amigos: "compartilha aí pra eu ver" → *indisponível na sua região* → foto da tela com o celular → bloqueou pra todo mundo |
| 17,3–23,1 s | `build.html` | "Calma." / "Respira." / "Tem outro jeito." / 3-2-1 |
| 23,1–28,9 s | `logo.html` | Refrão 2 da música (1:33,7): ScreenLink |
| 28,9–34,7 s | `step-room.html` | 1. Cria uma sala e manda o código |
| 34,7–40,6 s | `step-share.html` | 2. Escolhe o jogo (diálogo real de compartilhamento) |
| 40,6–52,2 s | `watch.html` | Refrão 3 (3:41,7). 3. Popup "Lucas is sharing" → Watch → a luta ao vivo: "DEMOCRACIA… RELATIVAAAAAA!!" × "DEFESAAA…. IMBROCHÁVEEEELLL!!!" → DOUBLE K.O., empate técnico |
| 52,2–58,0 s | `slides.html` | Não é só jogo: slides do TCC; recursos |
| 58,0–66,6 s | `outro.html` | Onde baixar; a batida final da faixa em 63,83 s |

O jogo (`assets/js/game.js`, "Treta em Brasília") é uma paródia em pixel art: os dois soltam o
especial e ninguém ganha.

### Música

`assets/audio/music-powerup.mp3` é a faixa inteira, então o `data-media-start` de cada pedaço em
`index.html` é o tempo na faixa original. Todo corte cai num tempo forte (82,5 BPM, compasso de
2,909 s):

| Vídeo | Faixa | Trecho |
| --- | --- | --- |
| 0–8,54 s | 2:20,1 | breakdown calmo sob o chat |
| 8,54–20,19 s | 2:51,7 | grave no erro, a subida |
| 20,19–34,74 s | 1:30,8 | a virada antes do refrão 2; refrão 2 em 23,10 s |
| 34,74–63,83 s | 3:35,9 | fim da frase antes do refrão 3; refrão 3 em 40,56 s (8 compassos) |
| 63,82–66,6 s | 4:38,3 | a batida final da faixa, no lugar do próximo tempo forte |

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
