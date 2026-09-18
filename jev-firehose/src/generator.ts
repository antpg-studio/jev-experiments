// Seeded live-chat firehose generator. Same seed => same message sequence.

export type Category =
  | "hype"
  | "emote"
  | "question"
  | "chatter"
  | "spam"
  | "scam"
  | "harassment"
  | "spoiler"
  | "selfpromo";

export type Lang = "english" | "spanish" | "portuguese" | "german" | "french" | "russian" | "japanese" | "korean" | "other";

export interface ChatMessage {
  seq: number;
  id: string;
  user: string;
  text: string;
  /** hidden ground-truth label from the generator, used only for the eval script and tests */
  category: Category;
  lang: Lang;
  t: number;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const emotes = ["KEKW", "PogChamp", "LUL", "Pog", "monkaS", "OMEGALUL", "Kappa", "PepeLaugh", "EZ Clap", "Sadge", "catJAM", "5Head", "widepeepoHappy", "GIGACHAD", "HYPERS"];
const games = ["Valorant", "Elden Ring", "Minecraft", "League", "Fortnite", "Baldur's Gate 3", "Tekken 8", "Apex", "Hollow Knight: Silksong", "Zelda"];
const names = ["xX_Dark", "pixel", "Nova", "kai", "TTV_", "moon", "ghost", "lil", "Zed", "Ryu", "quinn", "byte", "sora", "vex", "Mia", "Jo", "kev", "L0rd", "neo", "aki"];
const suffixes = ["", "", "_", "99", "2013", "TTV", "_gg", "x", "42", "_ow", "77", "ttv", "0", "og", "_yt"];

type Template = { lang: Lang; t: string[] };
type Corpus = Record<Category, Template[]>;

const corpus: Corpus = {
  hype: [
    { lang: "english", t: ["LETS GOOOO", "THAT WAS INSANE", "W streamer", "clip it clip it", "no way you hit that", "best {game} player alive", "we are so back", "this run is cracked", "GG EZ", "W chat W streamer", "gigachad play", "you are literally carrying", "hype in chat!!!", "insane clutch", "actually goated"] },
    { lang: "spanish", t: ["VAMOS QUE SE PUEDE", "eres una bestia", "que jugada increible", "el mejor de {game} sin duda", "vamooooos", "que locura hermano"] },
    { lang: "portuguese", t: ["QUE ISSO MANO", "muito bom demais", "melhor de {game} do mundo", "vai vai vai", "clutch monstruoso", "esse cara e brabo"] },
    { lang: "german", t: ["WAS FÜR EIN SPIEL", "krass, einfach krass", "bester {game} spieler", "weiter so!!", "unfassbar gut"] },
    { lang: "french", t: ["TROP FORT", "c'est incroyable", "meilleur joueur de {game}", "allez allez allez", "quelle action de fou"] },
    { lang: "russian", t: ["ПОГНАЛИ", "ты лучший", "это было безумие", "красавчик", "лучший игрок в {game}"] },
    { lang: "japanese", t: ["ナイス！！", "すごすぎる", "神プレイ", "最高だった", "うますぎ"] },
    { lang: "korean", t: ["미쳤다 ㄷㄷ", "역대급 플레이", "진짜 잘한다", "ㄱㄱㄱ", "레전드"] },
  ],
  emote: [
    { lang: "english", t: ["{emote}", "{emote} {emote}", "{emote} {emote} {emote}", "LULW", "?????", "!!!!", "F", "7", "o7", "gg", "xD", ":)", "lol", "lmaooo", "bruh", "sheesh", "ratio", "L", "W", "{emote} Clap"] },
  ],
  question: [
    { lang: "english", t: ["what mouse do you use?", "how long have you been playing {game}?", "what sens are you on?", "are you doing ranked later?", "whats your favorite agent?", "when is the next tournament?", "do you have a video on this build?", "what settings do you run for {game}?", "how do you get out of gold?", "is this on PC or console?", "can you explain why you did that rotate?", "what keyboard is that?", "how many hours in {game}?", "will you play {game} with viewers?", "what's your dpi?", "hey what headset is that", "@streamer why not take the top route?", "do you stream every day?"] },
    { lang: "spanish", t: ["que raton usas?", "cuantas horas tienes en {game}?", "vas a jugar con viewers hoy?", "que sensibilidad usas?", "de donde eres?", "cuando empiezas ranked?"] },
    { lang: "portuguese", t: ["qual mouse voce usa?", "quantas horas de {game}?", "vai jogar com inscritos hoje?", "qual sua sens?", "faz quanto tempo que voce streama?"] },
    { lang: "german", t: ["welche maus benutzt du?", "wie lange spielst du schon {game}?", "spielst du heute mit zuschauern?", "welche sens hast du?"] },
    { lang: "french", t: ["quelle souris tu utilises ?", "depuis combien de temps tu joues à {game} ?", "tu joues avec les viewers ce soir ?", "c'est quoi ta sensi ?"] },
    { lang: "russian", t: ["какая у тебя мышка?", "сколько часов в {game}?", "будешь играть со зрителями?", "какая сенса?"] },
    { lang: "japanese", t: ["マウスは何を使ってますか？", "{game}は何時間やってますか？", "今日は視聴者参加ありますか？", "感度いくつですか？"] },
    { lang: "korean", t: ["마우스 뭐 쓰세요?", "{game} 몇 시간 하셨어요?", "오늘 시참 하나요?", "감도 얼마예요?"] },
  ],
  chatter: [
    { lang: "english", t: ["chat is moving so fast", "hi everyone", "just got here what happened", "my dog is asleep on my keyboard", "im eating pizza rn", "anyone else lagging", "first time here", "back from work finally", "its 3am here lol", "gonna grab water brb", "hello from canada", "the vod from yesterday was fun", "this song is fire", "same energy as last stream", "chat calm down", "stream is a bit choppy for me", "who else is watching on their phone"] },
    { lang: "spanish", t: ["hola a todos", "acabo de llegar", "saludos desde mexico", "que paso me perdi", "el stream se me traba"] },
    { lang: "portuguese", t: ["boa noite galera", "cheguei agora", "salve do brasil", "o que aconteceu?", "to comendo pizza"] },
    { lang: "german", t: ["hallo zusammen", "bin gerade erst gekommen", "grüße aus berlin", "was ist passiert?"] },
    { lang: "french", t: ["salut tout le monde", "je viens d'arriver", "coucou de paris", "j'ai raté quoi ?"] },
    { lang: "russian", t: ["всем привет", "только зашел", "привет из москвы", "что случилось?"] },
    { lang: "japanese", t: ["こんにちは", "今来ました", "日本から見てます", "何があった？"] },
    { lang: "korean", t: ["안녕하세요", "지금 들어왔어요", "한국에서 보고 있어요", "무슨 일이에요?"] },
  ],
  spam: [
    { lang: "english", t: ["{emote} {emote} {emote} {emote} {emote} {emote} {emote} {emote}", "AAAAAAAAAAAAAAAAAAAAAAAAAAAA", "SPAM THIS {emote} SPAM THIS {emote} SPAM THIS {emote}", "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!", "LETS GO LETS GO LETS GO LETS GO LETS GO LETS GO LETS GO", "copypasta copypasta copypasta copypasta copypasta", "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1", "@{user} @{user} @{user} @{user} @{user} @{user}", "ヽ(ﾟ〇ﾟ)ﾉ ヽ(ﾟ〇ﾟ)ﾉ ヽ(ﾟ〇ﾟ)ﾉ ヽ(ﾟ〇ﾟ)ﾉ ヽ(ﾟ〇ﾟ)ﾉ"] },
  ],
  scam: [
    { lang: "english", t: ["free skins at valo-drop[.]xyz use code CHAT", "streamer is giving away 5000 vbucks claim here: free-vbucks-gift[.]com", "I made $4,300 last week from home, dm me for the method", "cheap nitro 90% off discord-nitro-promo[.]ru", "you've been selected for a $500 gift card, link in my bio", "buy followers/viewers cheap dm me", "🔥 FREE ROBUX generator working 2024 no survey 🔥", "your account has been flagged, verify at twitch-secure-login[.]co", "crypto pump tonight, join t.me/pumpsignals to 10x", "giving away 3 PS5s, first 50 to follow @totally_real_giveaway win"] },
    { lang: "spanish", t: ["skins gratis en valo-gratis[.]xyz codigo CHAT", "gane $3000 desde casa, escribeme por dm", "sorteo de 3 PS5 sigue a @sorteo_real_ya"] },
    { lang: "portuguese", t: ["skins gratis em skins-br[.]xyz codigo CHAT", "ganhei R$8000 em casa, me chama no pv", "nitro barato 90% off"] },
    { lang: "russian", t: ["бесплатные скины на valo-drop[.]ru код CHAT", "заработал 300к за неделю, пиши в лс", "розыгрыш 3 PS5 подпишись на @realgiveaway"] },
  ],
  harassment: [
    { lang: "english", t: ["kys trash streamer", "uninstall the game you are garbage", "nobody watches this crap, get a job", "you're so bad it's embarrassing, quit", "your voice is unbearable shut up", "@{user} shut your mouth idiot", "worst player i have ever seen, actual bot", "go back to your bronze lobby loser", "you should be banned from the internet", "you people are subhuman", "hope you lose every game tonight, clown", "fat pathetic loser lmao", "cry more you washed up nobody"] },
    { lang: "spanish", t: ["eres basura, desinstala", "callate idiota nadie te quiere", "que streamer mas patetico", "@{user} cierra la boca imbecil"] },
    { lang: "portuguese", t: ["desinstala o jogo lixo", "ninguem assiste isso, vai trabalhar", "cala a boca idiota", "pior player que ja vi"] },
    { lang: "german", t: ["du bist so schlecht, hör auf", "niemand will dich sehen, halt die klappe", "peinlichster streamer überhaupt"] },
    { lang: "french", t: ["t'es nul, désinstalle", "personne te regarde, ferme-la", "le pire joueur que j'ai vu"] },
    { lang: "russian", t: ["удали игру, бездарь", "тебя никто не смотрит, заткнись", "худший стример"] },
    { lang: "japanese", t: ["下手すぎる、やめろ", "誰も見てないよ、黙れ", "本当にゴミプレイ"] },
    { lang: "korean", t: ["진짜 못한다 접어라", "아무도 안 봐 닥쳐", "역대 최악의 스트리머"] },
  ],
  spoiler: [
    { lang: "english", t: ["the butler is the killer btw", "dont bother, Mohg kills you in phase 2 anyway", "spoiler: the main character dies at the end", "Team Liquid already won the final, its 3-1", "the twist is that the mentor was the villain the whole time", "in the last episode she leaves him", "the last boss is your brother", "the ending is just a dream, saved you 40 hours", "finals result: Sentinels lost 0-3, dont watch", "your dog dies in chapter 5 lol"] },
    { lang: "spanish", t: ["el mayordomo es el asesino", "el protagonista muere al final", "ya gano Liquid la final 3-1"] },
    { lang: "portuguese", t: ["o mordomo e o assassino", "o protagonista morre no final", "a Liquid ja ganhou a final 3-1"] },
    { lang: "german", t: ["der butler ist der mörder", "der hauptcharakter stirbt am ende", "Liquid hat das finale schon 3-1 gewonnen"] },
    { lang: "french", t: ["c'est le majordome le tueur", "le héros meurt à la fin", "Liquid a déjà gagné la finale 3-1"] },
    { lang: "japanese", t: ["犯人は執事だよ", "主人公は最後に死ぬ", "決勝はLiquidが3-1で勝った"] },
  ],
  selfpromo: [
    { lang: "english", t: ["follow my channel twitch.tv/{user} for {game} content", "check out my new video on {game}, link in bio", "I stream {game} too, come raid me after", "sub to my yt {user}_gaming pls", "come watch me instead im better at {game}", "drop a follow on my page {user}TTV thx", "new montage on my channel go watch"] },
    { lang: "spanish", t: ["sigan mi canal twitch.tv/{user}", "vean mi nuevo video de {game}", "yo tambien streameo {game}, pasen"] },
    { lang: "portuguese", t: ["sigam meu canal twitch.tv/{user}", "novo video de {game} no meu canal", "eu tambem streamo {game}, passa la"] },
    { lang: "russian", t: ["подписывайтесь на мой канал twitch.tv/{user}", "новое видео по {game} на моем канале"] },
  ],
};

// Roughly Twitch-like mix: mostly hype/emotes/chatter, a real stream of questions,
// and a thin but steady layer of things a mod actually has to deal with.
const mix: [Category, number][] = [
  ["hype", 24],
  ["emote", 22],
  ["chatter", 20],
  ["question", 14],
  ["spam", 5],
  ["scam", 3],
  ["harassment", 5],
  ["spoiler", 3],
  ["selfpromo", 4],
];
const mixTotal = mix.reduce((s, [, w]) => s + w, 0);

export const categories = mix.map(([c]) => c);

function pick<T>(rnd: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rnd() * arr.length)];
}

export interface Generator {
  next(): ChatMessage;
  seed: number;
}

export function createGenerator(seed: number): Generator {
  const rnd = mulberry32(seed);
  let seq = 0;
  const userPool = Array.from({ length: 400 }, () => pick(rnd, names) + pick(rnd, suffixes) + (rnd() < 0.5 ? String(Math.floor(rnd() * 1000)) : ""));
  return {
    seed,
    next() {
      let r = rnd() * mixTotal;
      let category: Category = "chatter";
      for (const [c, w] of mix) {
        if (r < w) {
          category = c;
          break;
        }
        r -= w;
      }
      const templates = corpus[category];
      // ~70% english on most streams; the rest spread over the other languages
      const tpl = rnd() < 0.7 || templates.length === 1 ? templates[0] : pick(rnd, templates.slice(1));
      const user = pick(rnd, userPool);
      const text = pick(rnd, tpl.t)
        .replaceAll("{emote}", () => pick(rnd, emotes))
        .replaceAll("{game}", () => pick(rnd, games))
        .replaceAll("{user}", () => pick(rnd, userPool));
      seq += 1;
      return { seq, id: `${seed}-${seq}`, user, text, category, lang: tpl.lang, t: 0 };
    },
  };
}

export const streamContext = {
  streamer: "novakat",
  game: "Hollow Knight: Silksong",
  title: "first playthrough, no spoilers pls | !mouse !sens",
  rules: "be respectful; no spoilers; no self-promotion, links or giveaways; no flooding",
};
