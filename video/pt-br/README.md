# Vídeo de apresentação — pt-BR

Vídeo de ~78 s do ScreenLink feito com [HyperFrames](https://hyperframes.heygen.com) (HTML + GSAP
renderizado quadro a quadro). O render final fica em `renders/screenlink-pt-br.mp4`.

## Roteiro

| Tempo | Cena (`compositions/`) | O que acontece |
| --- | --- | --- |
| 0–18,2 s | `chat.html` | Chat dos amigos: "compartilha aí pra eu ver" → *indisponível na sua região* → foto da tela com o celular → bloqueou pra todo mundo |
| 18,2–24,0 s | `build.html` | "Calma." / "Respira." / "Tem outro jeito." / 3-2-1 |
| 24,0–29,8 s | `logo.html` | Refrão 2 da música (1:33,7): ScreenLink |
| 29,8–35,6 s | `step-room.html` | 1. Cria uma sala e manda o código |
| 35,6–41,5 s | `step-share.html` | 2. Escolhe o jogo (diálogo real de compartilhamento) |
| 41,5–56,0 s | `watch.html` | Refrão 3. 3. Popup "Lucas está compartilhando" → Assistir → a luta ao vivo: "DEMOCRACIA… RELATIVAAAAAA!!" × "DEFESAAA…. IMBROCHÁVEEEELLL!!!" → DOUBLE K.O., todo mundo perdeu |
| 56,0–64,7 s | `slides.html` | Não é só jogo: slides do TCC; recursos |
| 64,7–77,7 s | `outro.html` | Onde baixar; a batida final da faixa em 74,91 s |

O jogo (`assets/js/game.js`, "Treta em Brasília") é uma paródia em pixel art: os dois soltam o
especial e ninguém ganha.

### Música

`assets/audio/music-powerup.mp3` é a faixa inteira, então o `data-media-start` de cada pedaço em
`index.html` é o tempo na faixa original. A faixa tem andamento fixo (82,5 BPM, compasso de
2,909 s), e cada corte liga dois compassos que tocam a mesma coisa em lugares diferentes da faixa,
então o tempo forte e o acorde continuam iguais dos dois lados:

| Vídeo | Faixa | Trecho | Corte |
| --- | --- | --- | --- |
| 0–21,09 s | 0:00,2–0:21,0 | introdução, sob o chat e a contagem | o compasso antes do refrão 1 vira o compasso antes do refrão 2 |
| 21,09–41,45 s | 1:30,8–1:51,2 | a virada e o refrão 2 (em 24,0 s) | o 7º compasso do refrão 2 vira o 7º compasso do refrão 3 (mesmos acordes, arranjo maior) |
| 41,45–70,55 s | 3:59,2–4:28,3 | refrão 3 até o início do final | o 1º compasso do final vira o 3º, que é igual |
| 70,55–77,7 s | 4:34,1–4:41,2 | a batida final da faixa (74,91 s) | — |

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
