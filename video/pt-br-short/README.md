# Vídeo de apresentação curto — pt-BR

Versão de ~1min35 do vídeo de [`video/pt-br`](../pt-br/README.md). Usa os mesmos arquivos
(`assets` é um link para `../pt-br/assets`) e cópias das cenas, ajustadas para caber. O render
fica em `renders/screenlink-pt-br-short.mp4`.

## Roteiro

| Tempo | Cena (`compositions/`) | O que acontece |
| --- | --- | --- |
| 0–18,2 s | `chat.html` | Chat dos amigos: "compartilha aí pra eu ver" → *indisponível na sua região* → bloqueou pra todo mundo |
| 18,2–24,0 s | `build.html` | "Calma e conta até 9." / "Respira." / "Tem outro jeito." / 3-2-1 |
| 24,0–29,8 s | `logo.html` | Refrão 1: ScreenLink |
| 29,8–35,6 s | `step-room.html` | 1. Cria uma sala e manda o código |
| 35,6–39,8 s | `step-share.html` | 2. Escolhe o jogo (um pouco mais rápido que na versão longa) |
| 39,8–54,4 s | `watch.html` | 3. Bia clica em Assistir → a luta, com a explosão no refrão 2 (47,09 s) → DOUBLE K.O. |
| 54,4–70,4 s | `relay.html` | Sem afetar sua internet: mesma lógica do torrent; o refrão 3 entra em 67,80 s |
| 70,4–76,2 s | `slides.html` | Não é só jogo: os slides do TCC, "Slide, planilha, código." |
| 76,2–82,0 s | `features.html` | "Sem cadastro" com "ninguém vai pegar meu telefone" / "pegaram meu telefone", depois "Código aberto e auditável." com "…vai chorar a noite toda hoje" |
| 82,0–95,0 s | `outro.html` | Onde baixar, com a risada; a batida final em 92,18 s |

## Música

A mesma edição da versão longa (`assets/audio/music-edit.mp3`), com dois trechos repetidos a menos.
Os dois cortes foram escolhidos de ouvido entre opções curtas: cada um sai de um compasso e entra no
mesmo compasso uma repetição depois, 10 ms antes do tempo forte.

| Vídeo | Na edição | Corte |
| --- | --- | --- |
| 0,03–41,44 s | 0:00–0:41,4 | — |
| 41,44–81,99 s | 1:04,7–1:45,2 | dentro do refrão 1, pula para a repetição da mesma frase |
| 81,99–95,0 s | 2:08,5–até o fim | sai do fim da 1ª metade do refrão 3 direto para o final da faixa |

## Preview e render

```sh
npx hyperframes@0.8.226 preview
npx hyperframes@0.8.226 render --output renders/screenlink-pt-br-short.mp4
```

Créditos em [`../pt-br/LICENSES.txt`](../pt-br/LICENSES.txt).
