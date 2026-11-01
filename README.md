# ScreenLink

> [English version](README.en.md)

Compartilhamento de tela com baixa latência entre amigos. Um app de bandeja onde você cria salas,
distribui um código de convite (estilo ZeroTier) e, quando alguém da sala começa a compartilhar,
todo membro online recebe um popup e pode assistir.

- **Servidor** — Bun + SQLite (`bun:sqlite`). Contas, salas, códigos de convite e sinalização via
  WebSocket. **O vídeo nunca passa pelo servidor.**
- **Cliente** — app de bandeja em Electron. Seletor de tela/janela, resolução, taxa de quadros,
  bitrate, codec.

## Download

Os instaladores estão na página de [Releases](https://github.com/dilincoln/screenlink/releases):

- **Windows**: `ScreenLink-x.y.z-win-setup.exe` (instalador) ou `-win-portable.exe` (sem
  instalação). Os builds não são assinados, então o SmartScreen pede confirmação na primeira
  execução (*Mais informações → Executar assim mesmo*).
- **Linux**: `.AppImage` (precisa do FUSE 2: `fuse2` no Arch, `libfuse2` no Debian/Ubuntu), `.deb`
  ou `.pacman` (`sudo pacman -U ScreenLink-*.pacman`).

Para publicar uma nova versão, envie uma tag: `git tag v0.2.0 && git push origin v0.2.0`. O
[workflow de Release](.github/workflows/release.yml) roda os testes, gera os builds de Linux e
Windows com essa versão e cria a release. `bun run dist` gera localmente em `dist/`.

## Rodando

```sh
bun install
bun run server          # http://localhost:3000, banco em ./screenlink.sqlite
bun run start           # o app de bandeja (rode em cada máquina)
bun test                # testes da árvore de relay + autenticação/admin
```

### Publicando o servidor (Docker / Coolify)

O `docker-compose.yml` funciona sem alterações no [Coolify](https://coolify.io): crie um recurso a
partir deste repositório com o build pack *Docker Compose*, defina `SERVER_PASSWORD` (obrigatória)
e, opcionalmente, `ADMIN_FINGERPRINT` na aba Environment Variables, e faça o deploy. O Coolify
atribui um domínio com HTTPS (`SERVICE_FQDN_SCREENLINK_3000`) e faz proxy dos WebSockets; o banco
fica no volume `screenlink-data`. No app, use a URL `https://` como servidor.

Sem Coolify:

```sh
docker build -t screenlink .
docker run -d -p 3000:3000 -e SERVER_PASSWORD=change-me -v screenlink-data:/data screenlink
```

Variáveis de ambiente do servidor:

| Variável              | Padrão                      | Significado                                                |
| --------------------- | --------------------------- | ---------------------------------------------------------- |
| `PORT`                | `3000`                      | Porta HTTP/WebSocket                                       |
| `DB_FILE`             | `screenlink.sqlite`         | Arquivo SQLite                                             |
| `ICE_SERVERS`         | STUN do Google              | Array JSON de `RTCIceServer`; coloque um servidor TURN aqui |
| `MAX_RELAY_DEPTH`     | `4`                         | Máximo de saltos entre quem compartilha e o espectador mais distante |
| `RECONNECT_GRACE_MS`  | `20000`                     | Por quanto tempo um cliente que caiu mantém seu lugar nas transmissões |
| `SERVER_PASSWORD`     | nenhuma                     | Senha compartilhada exigida para entrar; trocá-la desconecta todo mundo |
| `ADMIN_FINGERPRINT`   | nenhuma                     | Impressões digitais de dispositivos, separadas por vírgula, com acesso à visão de admin |

Inicie o cliente escondido na bandeja com `--hidden` (a opção "Iniciar com o sistema" faz isso).

## Contas, senha e admin

Não existe usuário nem senha por pessoa. Cada instalação cria um **par de chaves Ed25519** na
primeira execução (`identity.json` na pasta de dados do app); a conta *é* o dispositivo. A
**impressão digital** (fingerprint) são os primeiros 128 bits do SHA-256 da chave pública, exibida
no app com **F12**.

- Entrar = assinar um desafio de uso único do servidor com a chave do dispositivo. Uma impressão
  digital vista num print ou num log não serve para nada sem essa chave, então não dá para usá-la
  para se passar por um admin nem para driblar um banimento.
- Sair e entrar de novo no mesmo dispositivo devolve a mesma conta e as mesmas salas.
- A `SERVER_PASSWORD` controla a entrada, então sem ela ninguém cria nem entra em salas,
  compartilha ou assiste. Cada token lembra sob qual senha foi emitido, então trocar a senha
  desconecta todo mundo até digitarem a nova. Senhas erradas são limitadas a 10 por IP a cada 10
  minutos.
- Dispositivos listados em `ADMIN_FINGERPRINT` ganham uma visão de **Admin**: todos os usuários
  (impressão digital, salas, visto por último, online), todas as salas (dono, número de membros,
  quem está ao vivo) e banimentos. Banir uma impressão digital desconecta aquele dispositivo na
  hora e impede que ele entre. O banimento funciona até para impressões digitais que nunca
  entraram.
- A visão de admin **não mostra códigos de convite nem títulos de transmissões**: ser admin serve
  para gerenciar quem usa o servidor, mas não dá acesso a salas das quais você não é membro.
- Limitação: uma pessoa banida pode apagar o `identity.json` e ganhar uma nova impressão digital. É
  a senha do servidor que a impede de simplesmente entrar de novo — troque-a se isso acontecer.

## Como o relay funciona

Um servidor que repassa vídeo (um SFU) paga por cada espectador em banda de upload e CPU. Um P2P
puro faz quem compartilha pagar no lugar: 10 espectadores a 12 Mbps são 120 Mbps de upload. O
ScreenLink monta uma **árvore de relay**:

```
        quem compartilha
           /  |   \          quem compartilha atende até "Espectadores diretos" (padrão 3)
         v1   v2   v3
        /  \   |             espectadores repassam para até "Repassar para outros" (padrão 2)
      v4   v5  v6
```

- O servidor só decide quem se conecta a quem (`server/tree.ts`): cada novo espectador vai para
  baixo do nó mais raso com vaga livre, dentro de `MAX_RELAY_DEPTH`.
- Quando um relay sai, seus filhos são religados em outro lugar **junto com suas subárvores**;
  só as arestas que mudaram reconectam.
- Se não houver vaga, quem compartilha assume o espectador extra em vez de deixá-lo sem vídeo.
- Cada aresta é uma conexão WebRTC normal (oferta do pai, resposta do filho), então a travessia
  de NAT é STUN/ICE comum. Peers atrás de NAT simétrico precisam de um servidor TURN em
  `ICE_SERVERS`.

O custo: um espectador que repassa **decodifica e recodifica** o vídeo (navegadores não conseguem
repassar quadros já codificados para outra conexão), o que soma alguns ms por salto e um encoder
naquela máquina. Por isso a profundidade é limitada e o repasse pode ser desligado em cada
cliente.

## Latência (a parte meio Parsec)

O Parsec usa um protocolo UDP próprio e encoders de hardware. Dentro do WebRTC, os equivalentes
mais próximos são:

- **Codificação/decodificação por hardware**: H.264 é o preferido por padrão; VA-API fica ativado
  no Linux. O card da sala de quem compartilha mostra qual encoder está de fato em uso (ex.:
  `OpenH264 (software)` vs. um de hardware) e se a qualidade está limitada por CPU ou por banda.
- **Sem buffer de reprodução**: `jitterBufferTarget = 0` no receptor e o field trial
  `WebRTC-ZeroPlayoutDelay` do Chrome (o mesmo truque do Chrome Remote Desktop).
- **Começa nítido**: dicas no SDP (`x-google-start-bitrate`) começam perto do bitrate alvo em vez
  de subir a partir de ~300 kbps.
- **Redimensionamento na captura** (mantém a proporção) em vez de capturar em tamanho cheio e
  reduzir depois.
- **"Otimizar para"**: *Movimento* mantém a taxa de quadros (baixa a resolução sob pressão);
  *Detalhe* mantém o texto nítido (descarta quadros).
- Nas janelas de espectador, `I` mostra estatísticas ao vivo (fps, bitrate, áudio, tempo de
  decodificação, jitter buffer, RTT, salto), `O` alterna pixels 1:1, duplo clique/F11 para tela
  cheia. O **botão direito** abre um menu com o volume da transmissão (lembrado por pessoa que
  compartilha); `M` silencia.
- **Áudio**: Opus estéreo a 128 kbps com processamento de voz desligado (sem cancelamento de eco
  nem supressão de ruído, que estragam música e áudio de jogo). Áudio e vídeo propositalmente *não*
  são sincronizados: sincronizar faz o receptor segurar o vídeo para acompanhar o jitter buffer do
  áudio (dezenas de ms), e aqui a latência do vídeo ganha. Os relays repassam o áudio junto com o
  vídeo.

## Silenciando notificações

O sino ao lado do nome do app (ou **Silenciar notificações** no menu da bandeja) silencia o aviso
"X está compartilhando" e o som dele:

- **Por um tempo**: de 15 min a 8 horas, ou qualquer número de minutos/horas.
- **Até você reativar**.
- **Horário silencioso**: dias da semana e um intervalo de horário, ex.: seg–sex 08:00–18:00. Um
  intervalo que passa da meia-noite (22:00–07:00) pertence ao dia em que começa e vai até a manhã
  seguinte.

Os sons da sua própria transmissão (espectadores entrando/saindo) e o som de fim de algo que você
está assistindo continuam tocando: eles respondem a algo que você está fazendo. As regras ficam em
`client/mute.js` (testadas em `client/mute.test.js`).

## Sons

Tocados por uma janela escondida (`client/sound/`), já que o processo principal não toca áudio e a
janela da interface pode não existir quando o app inicia escondido. O volume fica em
Configurações (0 silencia).

| Som (`client/assets/`)   | Quem ouve                                                        |
| ------------------------ | ---------------------------------------------------------------- |
| `stream-start.mp3`       | quem compartilha, e os membros que recebem o aviso "está compartilhando" |
| `stream-stop.mp3`        | quem compartilha, e todo mundo que estava assistindo             |
| `viewer-joined.mp3`      | quem compartilha, quando um espectador entra                     |
| `viewer-left.mp3`        | quem compartilha, quando um espectador sai                       |

Um espectador que só muda de lugar na árvore de relay (ou reconecta) não faz som.

## Notas por plataforma

- **Wayland**: o portal do desktop mostra o próprio seletor de tela/janela depois de **Começar a
  compartilhar**, e o "alguém está compartilhando" usa uma notificação do sistema (apps no Wayland
  não conseguem posicionar um popup num canto).
- **X11 / Windows / macOS**: seletor dentro do app com miniaturas, e um popup do ScreenLink no
  canto inferior direito.
- **Áudio do sistema** é tudo que o computador toca **exceto o Discord e o próprio ScreenLink**,
  para que amigos numa chamada do Discord com você não ouçam a própria voz de volta, e os sons do
  ScreenLink (ou uma transmissão que você está assistindo) fiquem de fora
  (`client/system-audio.js`):
  - Linux: o [venmic](https://github.com/Vencord/venmic) cria um microfone virtual no PipeWire
    alimentado por todos os apps na saída padrão, exceto o Discord (Discord, PTB, Canary, Vesktop,
    Equibop) e o ScreenLink, incluindo apps que começarem a tocar depois.
  - Windows: loopback por processo do WASAPI no modo *exclude*
    ([loopback-capture](https://github.com/WerdoxDev/application-loopback), Windows 10 2004+). Ele
    consegue excluir uma árvore de processos: a do Discord enquanto estiver rodando (verificado a
    cada 10 s), senão a do ScreenLink.
  - Se a captura nativa falhar, cai para o loopback simples (tudo) e, se nem isso estiver
    disponível, para sem áudio, em vez de falhar ao compartilhar.

## Estrutura

```
server/
  index.ts       REST + sinalização WebSocket, transmissões em memória
  db.ts          schema e queries do SQLite
  tree.ts        posicionamento na árvore de relay (testado em tree.test.ts)
  auth.test.ts   login do dispositivo, senha, admin e banimentos contra um servidor rodando
client/
  main.js        bandeja, janelas, conexão com o servidor, roteamento da sinalização
  preload.cjs    ponte IPC compartilhada por todas as janelas
  shared/rtc.js  Fanout (envia para os filhos) e Upstream (recebe do pai)
  ui/            salas, convites, seletor de compartilhamento, configurações
  broadcaster/   janela escondida: captura + espectadores diretos
  viewer/        uma janela por transmissão assistida (também faz relay)
  popup/         aviso "X está compartilhando"
  sound/         janela escondida que toca os sons de notificação
```
