// The mock people and rooms of the video. seed.ts writes them to SQLite; live.ts says who is
// online and sharing in each shot.

export const USERS = [
  { key: "u-lucas", name: "Lucas" },
  { key: "u-bia", name: "Bia" },
  { key: "u-rafa", name: "Rafa" },
  { key: "u-duda", name: "Duda" },
  { key: "u-gabi", name: "Gabi" },
  { key: "u-thiago", name: "Thiago" },
  { key: "u-nanda", name: "Nanda" },
  { key: "u-caio", name: "Caio" },
  { key: "u-japa", name: "Japa" },
  { key: "u-ze", name: "Zé do Lag" },
  { key: "u-mari", name: "Mari" },
  { key: "u-pedrao", name: "Pedrão" },
  { key: "u-vini", name: "Vini" },
  { key: "u-lari", name: "Lari" },
  { key: "u-bruno", name: "Bruno" },
] as const;

export type UserKey = (typeof USERS)[number]["key"];

export const ROOMS: { id: string; name: string; code: string; owner: UserKey; members: UserKey[] }[] = [
  {
    id: "r-jogatina",
    name: "Jogatina de Sexta",
    code: "K7QM-XR4P-9TZN",
    owner: "u-lucas",
    members: ["u-bia", "u-rafa", "u-duda", "u-thiago", "u-japa", "u-ze", "u-caio"],
  },
  {
    id: "r-valorant",
    name: "Valorant 5stack",
    code: "VR5S-T4CK-88QW",
    owner: "u-rafa",
    members: ["u-lucas", "u-bia", "u-japa", "u-vini"],
  },
  {
    id: "r-minecraft",
    name: "Minecraft SMP",
    code: "MC9B-BRCK-HZ7K",
    owner: "u-duda",
    members: ["u-lucas", "u-caio", "u-lari", "u-pedrao", "u-mari", "u-bruno", "u-nanda"],
  },
  {
    id: "r-tcc",
    name: "TCC — Grupo 4",
    code: "TCC4-GR9P-2Q26",
    owner: "u-gabi",
    members: ["u-lucas", "u-bia", "u-nanda"],
  },
  {
    id: "r-rpg",
    name: "RPG de Quinta",
    code: "D2RP-GQNT-X3NA",
    owner: "u-thiago",
    members: ["u-lucas", "u-mari", "u-pedrao", "u-bia", "u-caio"],
  },
  {
    id: "r-speedrun",
    name: "Speedrun Gang",
    code: "SPD7-RUNG-4NG9",
    owner: "u-japa",
    members: ["u-lucas", "u-ze", "u-vini"],
  },
  {
    id: "r-cinema",
    name: "Cinema da Madrugada",
    code: "CNM4-DRGD-5PQX",
    owner: "u-bia",
    members: ["u-lucas", "u-rafa", "u-duda", "u-gabi", "u-lari", "u-mari", "u-nanda", "u-bruno", "u-vini"],
  },
];
