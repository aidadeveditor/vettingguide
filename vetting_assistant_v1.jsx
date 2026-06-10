import React, { useState, useMemo } from "react";

/* =========================================================================
   ASSISTANT DE VETTING — OneTouch
   Flux interactif tous LoB + génération de note interne et message marchand.
   Outil opérationnel : lisibilité d'un instrument de travail.
   ========================================================================= */

// ---- palette (instrument, pas vitrine) ----
const C = {
  ink: "#16202e",
  sub: "#5b6b7e",
  line: "#d9e0e8",
  panel: "#ffffff",
  bg: "#eef2f6",
  navy: "#1f3864",
  blue: "#2e75b6",
  blueSoft: "#e7f0f9",
  ok: "#2e7d4f",
  okSoft: "#e4f2e9",
  warn: "#b9770b",
  warnSoft: "#fbf1dd",
  danger: "#b3261e",
  dangerSoft: "#fbe6e4",
  amberSoft: "#fff6e3",
};

const LOBS = [
  { id: "metro", label: "Local — Metro", hint: "Self-service, signé marchand" },
  { id: "local", label: "Local — Rep-Signed", hint: "Signé par un commercial" },
  { id: "national", label: "National / Mid-Market", hint: "Enterprise" },
  { id: "glive", label: "GrouponLive", hint: "Événements live" },
  { id: "travel", label: "Travel", hint: "Voucher / Extranet / Tour / Property" },
  { id: "goods", label: "Goods INTL", hint: "Gazebo — hors NAM Gateway" },
];

// Marchés (le pays affine les règles PV)
const MARKETS = [
  { id: "US", label: "États-Unis", region: "NAM" },
  { id: "CA", label: "Canada", region: "NAM" },
  { id: "UK", label: "Royaume-Uni", region: "INTL" },
  { id: "FR", label: "France", region: "INTL" },
  { id: "DE", label: "Allemagne", region: "INTL" },
  { id: "ES", label: "Espagne", region: "INTL" },
  { id: "IT", label: "Italie", region: "INTL" },
  { id: "BE", label: "Belgique", region: "INTL" },
  { id: "NL", label: "Pays-Bas", region: "INTL" },
  { id: "IE", label: "Irlande", region: "INTL" },
  { id: "AU", label: "Australie", region: "INTL" },
  { id: "AE", label: "Émirats (UAE)", region: "INTL" },
];
const isNAM = (m) => m === "US" || m === "CA";
const noHandwrittenPV = (m) => m === "FR";          // manuscrit interdit
const noDrinkInRef = (m) => ["FR", "BE", "NL"].includes(m); // bottomless drinks
const priceListMonths = (m) => (["DE", "ES"].includes(m) ? 6 : 12); // Goods price list

// Quels contrôles s'appliquent selon le LoB
const APPLIES = {
  metro:    { dac7: true, pricing: true, licensing: true, pdselig: true, website: true, goods: false },
  local:    { dac7: true, pricing: true, licensing: true, pdselig: false, website: false, goods: false },
  national: { dac7: true, pricing: true, licensing: true, pdselig: false, website: false, goods: false },
  glive:    { dac7: true, pricing: true, licensing: true, pdselig: false, website: false, goods: false },
  travel:   { dac7: true, pricing: true, licensing: false, pdselig: false, website: false, goods: false },
  goods:    { dac7: true, pricing: true, licensing: false, pdselig: false, website: false, goods: true },
};

/* =========================================================================
   Petits composants UI
   ========================================================================= */
function Badge({ kind, children }) {
  const map = {
    ok: { bg: C.okSoft, fg: C.ok },
    warn: { bg: C.warnSoft, fg: C.warn },
    danger: { bg: C.dangerSoft, fg: C.danger },
    info: { bg: C.blueSoft, fg: C.blue },
  }[kind] || { bg: C.bg, fg: C.sub };
  return (
    <span style={{
      background: map.bg, color: map.fg, fontWeight: 700, fontSize: 11,
      letterSpacing: 0.4, textTransform: "uppercase", padding: "3px 8px",
      borderRadius: 5, display: "inline-block",
    }}>{children}</span>
  );
}

function SopNote({ children }) {
  return (
    <div style={{
      background: C.amberSoft, borderLeft: `4px solid ${C.warn}`,
      padding: "10px 14px", borderRadius: "0 8px 8px 0", marginTop: 14,
      fontSize: 13.5, lineHeight: 1.55, color: "#5d4708",
    }}>
      <div style={{ fontWeight: 800, fontSize: 11, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 4, color: C.warn }}>
        Rappel SOP
      </div>
      {children}
    </div>
  );
}

function Choice({ children, onClick, tone = "neutral" }) {
  const tones = {
    neutral: { border: C.line, hov: C.blue },
    ok: { border: "#bfe0cc", hov: C.ok },
    warn: { border: "#ecd8a8", hov: C.warn },
    danger: { border: "#eccac7", hov: C.danger },
  }[tone];
  const [h, setH] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        display: "block", width: "100%", textAlign: "left", cursor: "pointer",
        background: h ? C.blueSoft : C.panel,
        border: `1.5px solid ${h ? tones.hov : tones.border}`,
        borderRadius: 10, padding: "13px 16px", marginTop: 10,
        fontSize: 14.5, color: C.ink, lineHeight: 1.45,
        transition: "all .12s ease", fontFamily: "inherit",
      }}
    >
      {children}
    </button>
  );
}

/* =========================================================================
   ARBRES DE DÉCISION — un "résolveur" par contrôle.
   Chaque étape renvoie soit une question (questions), soit un résultat (result).
   result = { decision: 'pass'|'follow'|'reject'|'ir'|'hold'|'escalate',
              tag, internal, ecw, action }
   ========================================================================= */

const DECISIONS = {
  pass:     { label: "PASSE", kind: "ok" },
  follow:   { label: "FOLLOW-UP", kind: "warn" },
  ir:       { label: "IR à Sales", kind: "warn" },
  reject:   { label: "REJET", kind: "danger" },
  hold:     { label: "LEGAL HOLD", kind: "danger" },
  escalate: { label: "ESCALADER", kind: "danger" },
};

// --- DAC7 / DSA ---
function dac7Tree(lob) {
  const uaeExcluded = "UAE est exclu de ce contrôle.";
  return {
    title: "Contrôle 1 — DAC7 / DSA",
    intro: "Conformité fiscale (DAC7) et divulgations consommateur (DSA). Socle légal des nouveaux marchands.",
    sop: lob === "travel"
      ? <>DAC7 : UE, UK, Canada, Australie. <b>Exemption AU</b> : un voyage international sur la plateforme AU avec redemption hors AU est exempté → marquer « Verified » et noter la raison dans « RRDP Info Submitted by ». {uaeExcluded}</>
      : <>DAC7 s'applique à : UE, UK, Canada, Australie — <b>nouveaux marchands uniquement</b>, au niveau <b>Compte (Account)</b>, pas l'Opportunité. DSA = EU Feature Countries (hors UK). S'applique quelle que soit la catégorie du deal. {uaeExcluded}</>,
    start: "q_new",
    nodes: {
      q_new: {
        q: "Est-ce un nouveau marchand (nouveau compte) sur une plateforme concernée (UE / UK / Canada / Australie) ?",
        help: <>« Nouveau marchand » au sens DAC7 = un <b>compte dont le statut DAC7 n'a pas encore été établi</b> — pas « un marchand qui n'a jamais vendu ». Le contrôle se fait au niveau du <b>Compte (Account)</b>, pas de l'Opportunité.<br /><br />Donc même si le marchand <b>a déjà des offres</b> (ex. en France), tu ne sautes pas le contrôle : tu regardes le champ <b>« DAC7/DSA Info »</b> sur le Compte. S'il est déjà « Submitted/Verified » → il n'est pas « nouveau » au sens DAC7, tu passes. S'il est « Invalid/Missing » → tu le traites comme un nouveau (IR), peu importe son historique commercial.<br /><br />En clair : <b>c'est le champ qui décide, pas l'ancienneté du marchand.</b> Si tu n'es pas sûr, réponds « Oui » et laisse l'étape suivante lire le champ.</>,
        opts: [
          { t: "Non — marchand existant ou hors périmètre (US, UAE…)", tone: "ok", go: "r_na" },
          { t: "Oui — nouveau marchand dans le périmètre", go: lob === "travel" ? "q_au" : "q_field" },
        ],
      },
      ...(lob === "travel" ? {
        q_au: {
          q: "Voyage international sur la plateforme AU avec redemption HORS AU ?",
          opts: [
            { t: "Oui — exempté AU", tone: "ok", go: "r_au" },
            { t: "Non", go: "q_field" },
          ],
        },
        r_au: { result: {
          decision: "pass", tag: "—",
          internal: "DAC7 : exempté (voyage international AU, redemption hors AU). Champ DAC7/DSA marqué « Verified » ; raison notée dans RRDP Info Submitted by.",
          ecw: "", action: "Marquer « Verified » + noter l'exemption dans RRDP Info Submitted by.",
        }},
      } : {}),
      q_field: {
        q: "Le champ « DAC7/DSA Info » (niveau Compte) affiche-t-il « Submitted » ou « Verified » ?",
        help: <>Ce champ se trouve sur le <b>Compte (Account)</b> dans Salesforce, pas sur l'Opportunité. C'est <b>lui</b> qui détermine si la conformité DAC7/DSA est établie. « Submitted » = le marchand a fourni ses infos ; « Verified » = elles ont été validées — les deux te permettent d'avancer. « Invalid » ou champ vide = bloquant → IR.<br /><br />Astuce comptes liés : si le <b>compte parent</b> est « Verified » mais que cet enfant ne l'est pas encore, choisis l'option « parent Verified ».</>,
        opts: [
          { t: "Oui — Submitted ou Verified", tone: "ok", go: "q_self" },
          { t: "Le parent est Verified mais pas l'enfant", tone: "warn", go: "r_parent" },
          { t: "Non — Invalid / Missing", tone: "danger", go: "r_ir" },
        ],
      },
      q_self: {
        q: "Plateforme UE : la case « DSA/DAC7 Self-Certified » est-elle cochée ?",
        help: <>La case « Self-Certified » concerne le <b>DSA</b> et doit être cochée pour tout marchand opérant sur une <b>plateforme UE</b> (FR, DE, ES, IT, BE, NL, IE…). Hors UE (UK, CA, AU) elle n'est pas requise → choisis l'option « Oui (ou hors UE) ».<br /><br /><b>Important :</b> c'est une auto-attestation du marchand. Tu ne la coches <b>jamais</b> à sa place — si elle manque, c'est un IR.</>,
        opts: [
          { t: "Oui (ou marchand hors UE — non requis)", tone: "ok", go: "r_ok" },
          { t: "Non, case non cochée", tone: "danger", go: "r_ir_self" },
        ],
      },
      r_parent: { result: {
        decision: "pass", tag: "—",
        internal: "DAC7 : compte parent en Verified → compte enfant passé manuellement à « Verified ». Vetting autorisé.",
        ecw: "", action: "Passer manuellement le statut de l'enfant à « Verified ».",
      }},
      r_ok: { result: {
        decision: "pass", tag: "—",
        internal: "DAC7/DSA : champ « Submitted/Verified » et Self-Certified OK. Conforme.",
        ecw: "", action: "Continuer le vetting.",
      }},
      r_ir: { result: {
        decision: "ir", tag: "VAT/Registration Number - Missing",
        internal: "DAC7/DSA : champ « Invalid/Missing ». IR envoyé à l'Opportunity Owner. Le deal ne peut pas avancer tant que DAC7/DSA n'est pas Submitted ou Verified. NE PAS cocher Self-Certified à la place du marchand ; NE PAS rejeter.",
        ecw: "Le statut DAC7/DSA de ce compte doit être renseigné avant que le deal puisse avancer. Merci de soumettre / faire vérifier les informations DAC7/DSA côté marchand.",
        action: "Envoyer un IR à l'Opportunity Owner. Tag : VAT/Registration Number - Missing.",
      }},
      r_ir_self: { result: {
        decision: "ir", tag: "VAT/Registration Number - Missing",
        internal: "DAC7/DSA : case Self-Certified non cochée (plateforme UE). IR envoyé. À résoudre côté marchand — ne jamais cocher à sa place.",
        ecw: "La case DSA/DAC7 Self-Certified doit être cochée par le marchand avant la mise en ligne sur la plateforme UE.",
        action: "Envoyer un IR. Le marchand doit cocher lui-même la case Self-Certified.",
      }},
      r_na: { result: {
        decision: "pass", tag: "—",
        internal: "DAC7/DSA : non applicable (marchand existant ou hors périmètre).",
        ecw: "", action: "Aucune action DAC7 requise.",
      }},
    },
  };
}

// --- PRICING ---
// ---- Sous-flux réutilisable : VALIDITÉ d'un document PV ----
// Renvoie un objet de nodes à fusionner. entry = "pvv_start".
// Sur succès → va vers `okGo`. Sur échec → résultats IR/Follow-up dédiés.
function pvValidityNodes(market, okGo) {
  const fr = noHandwrittenPV(market);
  return {
    pvv_start: {
      q: "Le document PV est-il dans un format accepté ? (.pdf, .png ou .jpeg uniquement — pas de .doc/.xlsx/.txt ni d'éditable)",
      opts: [
        { t: "Oui — PDF / PNG / JPEG", go: "pvv_type" },
        { t: "Non — format éditable / interdit", tone: "warn", go: "rpv_format" },
      ],
    },
    pvv_type: {
      q: "Quel type de PV ?",
      opts: [
        { t: "Capture du site marchand / concurrent (ex. Treatwell)", go: "pvv_screenshot" },
        { t: "Reçu ou facture", go: "pvv_receipt" },
        { t: "Menu / liste de prix (price list)", go: "pvv_pricelist" },
        { t: "Manuscrit (dernier recours)", tone: fr ? "danger" : "warn", go: fr ? "rpv_handwritten_fr" : "pvv_owner" },
      ],
    },
    pvv_screenshot: {
      q: "La capture respecte-t-elle TOUTES ces conditions : moins de 30 jours, horodatage (timestamp) visible ET URL visible ?",
      help: <>Une capture de site n'est valable comme PV que si on peut <b>tout vérifier</b> : la date (≤ 30 jours), un <b>horodatage</b> visible (date/heure de la capture) et l'<b>URL</b> de la page. Sans ces éléments, impossible de prouver que c'est bien le prix actuel du marchand.<br /><br />Cas fréquent : la capture jointe par Sales est absente ou fausse, <b>mais le bon prix est sur le site</b> → c'est à toi (agent CO) de reprendre la capture et de l'attacher à l'opportunité.</>,
      opts: [
        { t: "Oui — < 30 j + timestamp + URL", tone: "ok", go: "pvv_owner" },
        { t: "Manque timestamp", tone: "warn", go: "rpv_timestamp" },
        { t: "Plus de 30 jours", tone: "warn", go: "rpv_30days" },
        { t: "Capture absente/incorrecte mais bon prix sur le site", tone: "warn", go: "rpv_take_screenshot" },
      ],
    },
    pvv_receipt: {
      q: "Le reçu / la facture date-t-il de moins de 3 mois ?",
      opts: [
        { t: "Oui — moins de 3 mois", tone: "ok", go: "pvv_owner" },
        { t: "Non — plus de 3 mois", tone: "warn", go: "rpv_receipt_old" },
      ],
    },
    pvv_pricelist: {
      q: `Liste de prix : pour les deals Goods, l'ancienneté max est de ${priceListMonths(market)} mois (DE/ES : 6, autres : 12). Pour les services hors Goods, pas de date d'expiration requise. Le document est-il conforme ?`,
      opts: [
        { t: "Oui — conforme (ou service hors Goods)", tone: "ok", go: "pvv_owner" },
        { t: "Non — liste de prix Goods trop ancienne", tone: "warn", go: "rpv_pricelist_old" },
      ],
    },
    pvv_owner: {
      q: "Le document inclut-il le logo, le nom OU l'adresse du marchand ?",
      help: <>Il faut pouvoir relier le document au marchand : <b>logo, nom ou adresse</b> suffit (un seul des trois).<br /><br />S'il n'y en a aucun, on peut quand même l'accepter <b>si on a la preuve que c'est bien le marchand qui a envoyé le document</b> — par exemple une capture de l'échange email, à condition que la <b>signature de l'email</b> contienne nom/adresse/logo.<br /><br /><b>Attention :</b> une simple confirmation par email (« oui ce prix est correct ») n'est <b>pas</b> un PV valide — il faut un vrai document de prix.</>,
      opts: [
        { t: "Oui — identité marchand présente", tone: "ok", go: okGo },
        { t: "Non, mais preuve d'email du marchand (signature avec nom/adresse/logo)", tone: "ok", go: okGo },
        { t: "Non — aucune identité ni preuve d'envoi", tone: "warn", go: "rpv_no_owner" },
        { t: "Seulement une confirmation email du marchand", tone: "danger", go: "rpv_email_only" },
      ],
    },
    // résultats du sous-flux validité
    rpv_format: { result: { decision: "ir", tag: "—", internal: "PV : format non accepté (seuls .pdf/.png/.jpeg, pas d'éditable). IR pour un PV au bon format.", ecw: "Le document de prix fourni n'est pas dans un format accepté. Merci de fournir un PDF, PNG ou JPEG (les fichiers éditables type .doc/.xlsx/.txt ne sont pas acceptés).", action: "IR — PV au format .pdf/.png/.jpeg." }},
    rpv_timestamp: { result: { decision: "follow", tag: "Proof of Pricing Document Provided does not Include a Timestamp", internal: "PV : capture sans horodatage. Follow-Up.", ecw: "Le Proof of Pricing fourni ne comporte pas d'horodatage. Merci de fournir un document horodaté.", action: "Follow-Up — timestamp manquant." }},
    rpv_30days: { result: { decision: "follow", tag: "Proof of Pricing Document Provided is not from the last 30 Days", internal: "PV : capture de plus de 30 jours. Follow-Up.", ecw: "Le Proof of Pricing fourni date de plus de 30 jours. Merci de fournir un document horodaté de moins de 30 jours.", action: "Follow-Up — PV de plus de 30 jours." }},
    rpv_take_screenshot: { result: { decision: "ir", tag: "—", internal: "PV : capture absente/incorrecte mais le bon prix figure sur le site → l'agent CO prend lui-même la capture du prix sur le site du marchand et l'attache à l'opportunité.", ecw: "", action: "Prendre soi-même la capture du prix sur le site marchand et l'attacher à l'opportunité (puis poursuivre)." }},
    rpv_receipt_old: { result: { decision: "ir", tag: "—", internal: "PV : reçu/facture de plus de 3 mois → non valide. IR pour un justificatif récent.", ecw: "Le reçu / la facture fourni date de plus de 3 mois. Merci de fournir un justificatif de moins de 3 mois.", action: "IR — justificatif de moins de 3 mois." }},
    rpv_pricelist_old: { result: { decision: "ir", tag: "—", internal: `PV : liste de prix Goods trop ancienne (max ${priceListMonths(market)} mois pour ce marché). IR.`, ecw: "La liste de prix fournie est trop ancienne pour ce marché. Merci de fournir une liste de prix plus récente.", action: "IR — liste de prix Goods trop ancienne." }},
    rpv_handwritten_fr: { result: { decision: "ir", tag: "—", internal: "PV : manuscrit présenté — INTERDIT en France. Demander un autre justificatif.", ecw: "Un justificatif de prix manuscrit ne peut pas être accepté. Merci de fournir un autre document (site, facture, liste de prix au format PDF/PNG/JPEG).", action: "IR — manuscrit refusé (FR)." }},
    rpv_no_owner: { result: { decision: "ir", tag: "—", internal: "PV : aucune identité marchand (logo/nom/adresse) et aucune preuve d'envoi par le marchand. Non valide.", ecw: "Le document de prix ne permet pas d'identifier le marchand (logo, nom ou adresse manquants). Merci de fournir un document identifiable ou la preuve que vous l'avez transmis (email avec signature).", action: "IR — identité marchand manquante." }},
    rpv_email_only: { result: { decision: "ir", tag: "—", internal: "PV : simple confirmation par email du marchand — NON acceptée comme PV valide. Demander un document conforme.", ecw: "Une confirmation par email ne peut pas servir de Proof of Pricing. Merci de fournir un document de prix valide (site, facture, ou liste de prix).", action: "IR — email seul refusé." }},
  };
}

// --- PRICING (par LoB + marché, aligné Price Verification Guidelines) ---
function pricingTree(lob, market) {
  const isGlive = lob === "glive";
  const isTravel = lob === "travel";
  const isGoods = lob === "goods";
  const isMetro = lob === "metro";
  const nam = isNAM(market);
  const drinkRule = noDrinkInRef(market)
    ? "Bottomless drinks : sur ce marché (FR/BE/NL) AUCUN prix de boisson n'entre dans le prix de référence."
    : "Bottomless drinks : valeur basée sur les 3 boissons les plus chères incluses ; thé illimité = 2 théières max.";
  const convNote = (lob === "local" || lob === "glive" || lob === "national")
    ? " Devise étrangère : convertir via Google Converter en devise locale (±5 % toléré), capture attachée."
    : "";

  // SOP par variante
  const sop = isGoods
    ? <>Goods : PV requis dès qu'il y a une remise. PV valide = URL vendeur/fabricant, image, prix, achetable. Unit Value SF ≤ PV. Liste de prix : <b>{priceListMonths(market)} mois</b> max sur ce marché (DE/ES 6, autres 12). UK + marque T1 Comparable → Reputable Retailer/fabricant (refurb : PV vendeur OK).</>
    : isTravel
    ? <>Booking & Hotel Trader : <b>pas de PV</b>. Extranet : PV par add-on inclus dans le prix de référence (ne pas masquer la remise des Extranet 0 %). Voucher : PV pour la nuitée + chaque add-on. PV Travel en devise du pays du partenaire.</>
    : isGlive
    ? <>GLive : tenter de valider (site ou PV ; LiveNation Tour Docs acceptés). Si validable → notre prix ≤ site. Si non validable / PV non conforme → <b>pousser sans IR</b>.{convNote}</>
    : isMetro
    ? <>Metro : prix vérifié via le lien fourni par le marchand. Si service listé mais notre prix &gt; site → amender la valeur. Si l'ajustement crée une remise négative → Follow-Up « Incorrect Pricing » (les DEUX prix dans l'ECW). Service non listé / pas de prix / site KO → approuver (US) ou approuver avec remise masquée (INTL).</>
    : <>NAM &amp; CA Local : <b>PV requis si remise ≥ 40 %</b>. Comparer site (et amendement si « Signed with the contract ») vs SF. Site &lt; SF → <b>IR</b> même si « Signed with the contract ». Pas de prix site → champ Proof of Pricing en SF.{convNote}</>;

  // Point d'entrée selon variante
  let start;
  if (isTravel) start = "q_traveltype";
  else if (isGlive) start = "q_glive";
  else if (isGoods) start = "q_goods_disc";
  else if (isMetro) start = "q_metro";
  else start = "q_namlocal_disc"; // local / national / rep-signed

  const nodes = {
    // ---------- TRAVEL ----------
    q_traveltype: {
      q: "Quel type de deal Travel ?",
      opts: [
        { t: "Booking ou Hotel Trader — pas de PV", tone: "ok", go: "r_booking" },
        { t: "Extranet (INTL)", go: "q_extranet" },
        { t: "Voucher (INTL)", go: "q_voucher" },
        { t: "Tour Operator", go: "q_tour" },
        { t: "Property", go: "q_prop" },
      ],
    },
    r_booking: { result: { decision: "pass", tag: "—", internal: "Pricing Travel : deal Booking / Hotel Trader → aucun PV requis.", ecw: "", action: "Continuer." }},
    q_extranet: {
      q: "Chaque add-on inclus dans le prix de référence a-t-il un PV ? (rappel : ne pas masquer la remise des Extranet 0 %)",
      help: <>Le <b>prix de référence</b> (reference price) est le « prix barré » à partir duquel on calcule la remise. Pour un deal Travel, il agrège la nuitée et tout ce qui est inclus : petit-déjeuner, bouteille de vin, etc. — chacun de ces <b>add-ons</b> doit avoir son propre justificatif de prix.<br /><br />« Extranet 0 % » : même sans remise affichée, ne masque pas la remise sur ces deals.</>,
      opts: [
        { t: "Oui — un PV par add-on", tone: "ok", go: "pvv_start" },
        { t: "Non — PV manquant pour un add-on", tone: "warn", go: "r_ir_extranet" },
      ],
    },
    r_ir_extranet: { result: { decision: "ir", tag: "—", internal: "Pricing Extranet : PV manquant pour un add-on inclus dans le prix de référence. IR.", ecw: "Un Proof of Pricing est requis pour chaque add-on inclus dans le prix de référence. Merci de le fournir.", action: "IR — PV par add-on." }},
    q_voucher: {
      q: "Y a-t-il un PV pour la nuitée (room night rate) ET pour chaque add-on inclus dans le prix de référence ?",
      opts: [
        { t: "Oui — nuitée + add-ons couverts", tone: "ok", go: "pvv_start" },
        { t: "Non — PV manquant", tone: "warn", go: "r_ir_voucher" },
      ],
    },
    r_ir_voucher: { result: { decision: "ir", tag: "—", internal: "Pricing Voucher : PV requis pour la nuitée + chaque add-on inclus dans le prix de référence. IR. (PV en devise du pays du partenaire.)", ecw: "Un Proof of Pricing est requis pour la nuitée et pour chaque add-on inclus dans le prix de référence. Merci de le fournir.", action: "IR — PV nuitée + add-ons." }},
    q_tour: {
      q: "Le doc de soumission Sales est-il attaché ET les salient features correspondent-elles aux options ?",
      opts: [
        { t: "Oui, tout correspond", tone: "ok", go: "r_pass" },
        { t: "Doc manquant ou écart", tone: "warn", go: "r_ir_tour" },
      ],
    },
    r_ir_tour: { result: { decision: "ir", tag: "—", internal: "Pricing Tour Operator : doc de soumission manquant ou écart de salient features. IR à Sales.", ecw: "Merci de fournir / corriger le document de soumission (les caractéristiques ne correspondent pas aux options du deal).", action: "IR à Sales." }},
    q_prop: {
      q: "Le prix Groupon est-il ≤ au prix du site (hôtel) ?",
      opts: [
        { t: "Oui, prix ≤ site", tone: "ok", go: "r_pass" },
        { t: "Non, Groupon plus cher", tone: "warn", go: "r_ir_prop" },
      ],
    },
    r_ir_prop: { result: { decision: "ir", tag: "—", internal: "Pricing Property : prix Groupon supérieur au site. IR à Sales (le prix Groupon ne peut pas être supérieur).", ecw: "Le prix du deal est supérieur à celui affiché sur le site ; merci de l'aligner.", action: "IR à Sales." }},

    // ---------- GLIVE ----------
    q_glive: {
      q: "Le prix est-il validable (site, PV acceptable, ou LiveNation Tour Doc) ?",
      opts: [
        { t: "Oui — via le site", go: "q_metro_like" },
        { t: "Oui — via un document PV", go: "pvv_start" },
        { t: "Non validable / PV non conforme", tone: "ok", go: "r_glivepush" },
      ],
    },
    r_glivepush: { result: { decision: "pass", tag: "—", internal: "Pricing GLive : prix non validable et PV non conforme → deal poussé sans IR (règle GLive).", ecw: "", action: "Pousser le deal sans IR." }},

    // ---------- GOODS ----------
    q_goods_disc: {
      q: "Le deal a-t-il une remise ?",
      opts: [
        { t: "0 % de remise (Sell Price = Unit Value)", tone: "ok", go: "r_pass_nodisc" },
        { t: "Oui — il y a une remise", go: "q_goods_pv" },
      ],
    },
    r_pass_nodisc: { result: { decision: "pass", tag: "—", internal: "Pricing : 0 % de remise → pas de vérification de prix nécessaire (vérifier seulement Sell Price = Unit Value).", ecw: "", action: "Continuer." }},
    q_goods_pv: {
      q: "Un PV est-il attaché ET la Unit Value SF ≤ prix du PV ?",
      opts: [
        { t: "Oui — PV présent, Unit Value ≤ PV", tone: "ok", go: "pvv_start" },
        { t: "PV manquant ou Unit Value > PV", tone: "warn", go: "r_ir_goods" },
      ],
    },
    r_ir_goods: { result: { decision: "ir", tag: "—", internal: "Pricing Goods : PV manquant ou Unit Value > PV. IR. Rappel : Amazon OK si « Dispatched and sold by Amazon » ou nom vendeur = SF ; eBay seulement si boutique propre ; Allegro/AliExpress/convertisseurs refusés.", ecw: "Merci de fournir un Proof of Pricing valide (URL vendeur/fabricant, image produit, prix, produit achetable) ; la valeur du deal ne peut pas dépasser le prix justifié.", action: "IR à Sales." }},

    // ---------- METRO (Global) ----------
    q_metro: {
      q: "Le service exact est-il listé sur le site du marchand, et comment se compare le prix ?",
      opts: [
        { t: "Listé — notre prix > site", tone: "warn", go: "q_metro_neg" },
        { t: "Listé — prix correct ou notre prix ≤ site", tone: "ok", go: "r_pass" },
        { t: "Non listé / pas de prix / site KO", tone: "warn", go: "r_metro_nolist" },
      ],
    },
    q_metro_neg: {
      q: "Après amendement de la valeur au prix du site, la remise devient-elle négative ?",
      help: <>Si tu baisses la valeur de référence pour l'aligner sur le prix du site, la remise peut devenir <b>négative</b> — c'est-à-dire que le Sell Price Groupon serait <b>plus élevé</b> que le prix réel du marchand. Dans ce cas on n'amende pas en silence : on fait un Follow-Up « Incorrect Pricing » avec <b>les deux prix dans l'ECW</b> (le prix régulier SF et le prix du site), pour que le marchand voie exactement quoi corriger.</>,
      opts: [
        { t: "Non — remise toujours positive", tone: "ok", go: "r_metro_amended" },
        { t: "Oui — remise négative", tone: "warn", go: "r_metro_follow" },
      ],
    },
    r_metro_amended: { result: { decision: "ir", tag: "—", internal: "Pricing Metro : service listé, notre prix > site → valeur amendée au prix du site. Capture attachée, IR Account Owner, #valueadjusted en Context Notes. " + drinkRule, ecw: "", action: "Amender SF → capture → attacher → IR Account Owner → #valueadjusted." }},
    r_metro_follow: { result: { decision: "follow", tag: "Incorrect Pricing - Doesn't Match With Website (Value)", internal: "Pricing Metro : amender la valeur créerait une remise négative → Follow-Up. ECW doit inclure les DEUX prix (SF + site). (Variante Sell Price → tag « Incorrect Pricing - Competing offer found ».)", ecw: "Nous constatons que le prix régulier sur votre site est de [PRIX SITE], alors que le prix régulier saisi dans le deal est de [PRIX SF]. Merci d'aligner le prix régulier du deal sur celui de votre site, ou de fournir un Proof of Pricing à jour justifiant le montant supérieur.", action: "Follow-Up — Incorrect Pricing (les deux prix dans l'ECW)." }},
    r_metro_nolist: { result: { decision: "pass", tag: "—", internal: "Pricing Metro : service non listé / pas de prix / site KO → approuver" + (nam ? " (US : approbation simple)." : " avec remise masquée (INTL)."), ecw: "", action: nam ? "Approuver." : "Approuver avec remise masquée (INTL)." }},
    // entrée GLive «via le site» réutilise la logique metro-like
    q_metro_like: {
      q: "Notre prix dépasse-t-il le prix listé sur le site ?",
      opts: [
        { t: "Non — notre prix ≤ site", tone: "ok", go: "r_pass" },
        { t: "Oui — notre prix > site", tone: "warn", go: "r_metro_amended" },
      ],
    },

    // ---------- NAM & CA LOCAL / NATIONAL (non-Metro) ----------
    q_namlocal_disc: {
      q: "Quelle est la remise du deal ?",
      help: <>Sur NAM &amp; CA Local (deals non-Metro), un <b>Proof of Pricing n'est obligatoire qu'à partir de 40 % de remise</b>. En dessous, pas de PV requis — mais si tu vois un prix public inférieur à SF, tu signales quand même (IR). La remise = écart entre le prix de référence (Unit/Original Value) et le Sell Price.</>,
      opts: [
        { t: "Inférieure à 40 %", tone: "ok", go: "q_local_site_lowdisc" },
        { t: "40 % ou plus — PV requis", go: "q_local_site" },
      ],
    },
    q_local_site_lowdisc: {
      q: "Y a-t-il un prix public sur le site du marchand, et correspond-il à SF ?",
      opts: [
        { t: "Oui — correspond (ou pas de PV requis ici)", tone: "ok", go: "r_pass" },
        { t: "Site < SF (ou amendement < SF)", tone: "warn", go: "r_ir_local" },
      ],
    },
    q_local_site: {
      q: "Y a-t-il du prix public sur le site (ou autre source officielle) ?",
      opts: [
        { t: "Oui — prix public disponible", go: "q_local_compare" },
        { t: "Non — aucun prix public", go: "q_local_pvfield" },
      ],
    },
    q_local_compare: {
      q: "Le prix public correspond-il aux prix SF (et à l'amendement signé si « Signed with the contract ») ?",
      opts: [
        { t: "Oui — tout correspond", tone: "ok", go: "pvv_start" },
        { t: "Site < SF, OU site < amendement", tone: "warn", go: "r_ir_local" },
      ],
    },
    r_ir_local: { result: { decision: "ir", tag: "—", internal: "Pricing NAM/CA Local : le prix public du site est inférieur aux prix SF (ou à l'amendement). IR obligatoire même si le champ Proof of Pricing dit « Signed with the contract ».", ecw: "Le prix affiché sur votre site est inférieur au prix saisi dans le deal. Merci d'aligner les prix ou de fournir un justificatif à jour.", action: "IR — discrepancy site/SF (même si « Signed with the contract »)." }},
    q_local_pvfield: {
      q: "Que dit le champ « Proof of Pricing » dans Salesforce ?",
      help: <>Ce champ (sur l'opportunité/compte en SF) indique comment le prix est censé être justifié.<br /><br /><b>« Signed with the contract »</b> = le prix est censé figurer dans un <b>amendement signé</b> joint au contrat → il faut ouvrir l'accord et vérifier que l'amendement de prix est bien attaché ET signé.<br /><b>« Merchant Will Provide Later »</b> = le marchand doit encore envoyer son justificatif → on attend / IR.<br /><b>Autre valeur</b> = pas de justificatif clair → IR pour demander un Proof of Pricing.</>,
      opts: [
        { t: "« Signed with the contract »", go: "q_local_amendment" },
        { t: "« Merchant Will Provide Later »", tone: "warn", go: "r_local_later" },
        { t: "Autre valeur", tone: "warn", go: "r_ir_pvfield" },
      ],
    },
    q_local_amendment: {
      q: "Ouvrir l'accord signé en SF : un amendement de prix est-il attaché ET signé ?",
      help: <>Un <b>amendement de prix</b> est l'avenant au contrat qui fixe les prix de référence. « Attaché ET signé » veut dire : le document est bien joint à l'accord en SF <b>et</b> porte les signatures. Si l'un des deux manque (pas joint, ou joint mais non signé) → IR pour réclamer la signature ou un Proof of Pricing. Un champ qui dit « Signed with the contract » ne suffit pas à lui seul : tu dois <b>voir</b> l'amendement signé.</>,
      opts: [
        { t: "Oui — amendement attaché et signé", tone: "ok", go: "r_pass" },
        { t: "Non attaché ou non signé", tone: "warn", go: "r_ir_amendment" },
      ],
    },
    r_ir_amendment: { result: { decision: "ir", tag: "—", internal: "Pricing : champ « Signed with the contract » mais amendement de prix non attaché ou non signé. IR demandant la signature ou un Proof of Pricing.", ecw: "L'amendement de prix lié au contrat n'est pas signé ou n'est pas joint. Merci de fournir l'amendement signé ou un Proof of Pricing.", action: "IR — amendement signé / PV." }},
    r_local_later: { result: { decision: "ir", tag: "—", internal: "Pricing : pas de prix public, champ PV = « Merchant Will Provide Later ». Le deal nécessite un PV s'il y a une remise. IR / attendre le PV.", ecw: "Un Proof of Pricing est requis pour lancer ce deal avec remise. Merci de le fournir.", action: "IR — attendre le PV (Merchant Will Provide Later)." }},
    r_ir_pvfield: { result: { decision: "ir", tag: "—", internal: "Pricing : pas de prix public et champ PV ≠ « Merchant Will Provide Later » / ≠ « Signed with the contract ». IR demandant un Proof of Pricing.", ecw: "Un Proof of Pricing est requis pour valider le prix de ce deal. Merci de le fournir.", action: "IR — demander le PV." }},

    // ---------- résultats partagés ----------
    r_pass: { result: { decision: "pass", tag: "—", internal: "Pricing : prix validé (correspond au site / PV conforme). " + drinkRule, ecw: "", action: "Continuer le vetting." }},
    // (le PV validé via pvv_* retombe ici)
    r_pv_ok: { result: { decision: "pass", tag: "—", internal: "Pricing : document PV vérifié et conforme (format, ancienneté, identité marchand). Prix validé.", ecw: "", action: "Continuer le vetting." }},

    // ---------- sous-flux VALIDITÉ PV (réutilisable) ----------
    ...pvValidityNodes(market, "r_pv_ok"),
  };

  return { title: "Contrôle 2 — Pricing", intro: "Valider que le prix fourni par le marchand est bien celui qu'il pratique habituellement. Les règles de Proof of Pricing dépendent du LoB et du marché.", sop, start, nodes };
}

// --- LICENSING ---
function licensingTree(lob) {
  const gliveLP = lob === "glive";
  return {
    title: "Contrôle 3 — Licensing",
    intro: "La LVG (Legal Vetting Guidelines) est la source unique de vérité pour les exigences de licence par PDS.",
    sop: <>Statut LVG : <b>Blank</b> = rien à vérifier · <b>LP</b> = License Check {gliveLP ? "(GLive : License Check seul, pas d'Online Reviews/Location)" : "(+ Online Reviews & Location si Massage)"} · <b>DNC/Ban</b> (Metro) = rejet. Plus de 3 lieux : preuve de politique de qualification acceptée — SAUF sports aériens & vols de loisir (toujours licence). PDS non couvert = pas de contrôle licence requis.</>,
    start: "q_status",
    nodes: {
      q_status: {
        q: "Quel est le statut du PDS dans la LVG ?",
        help: <>La <b>LVG (Legal Vetting Guidelines)</b> est le tableur où Legal indique, pour chaque PDS, le niveau d'exigence :<br /><b>Blank</b> = aucune licence à vérifier.<br /><b>LP (Legal Parameters)</b> = il faut un License Check (et, pour les massages, aussi Online Reviews &amp; Location).<br /><b>DNC / Ban</b> = catégorie interdite → rejet.<br /><br />Si le PDS n'apparaît <b>pas du tout</b> dans la LVG/SOP, on ne l'invente pas : pas d'exigence explicite = pas de contrôle de licence (et on peut signaler le manque via le formulaire Asana).</>,
        opts: [
          { t: "Blank — rien à vérifier", tone: "ok", go: "r_blank" },
          { t: "LP (Legal Parameters)", go: gliveLP ? "q_license" : "q_massage" },
          { t: "DNC / Ban (Metro)", tone: "danger", go: "r_dnc" },
          { t: "PDS non couvert dans LVG/SOP", tone: "ok", go: "r_blank" },
        ],
      },
      q_massage: {
        q: "Le PDS est-il un PDS Massage ?",
        opts: [
          { t: "Oui — Massage", go: "q_license_massage" },
          { t: "Non — autre PDS LP", go: "q_license" },
        ],
      },
      q_license_massage: {
        q: "License Check + Online Reviews Check + Location Check : tous OK ?",
        opts: [
          { t: "Oui — licence valide, reviews & location OK", tone: "ok", go: "r_pass" },
          { t: "Licence manquante", tone: "warn", go: "r_missing" },
          { t: "Licence expirée", tone: "warn", go: "r_expired" },
          { t: "Échec Online Reviews/Location (PDS high-risk)", tone: "danger", go: "r_nmcheck" },
        ],
      },
      q_license: {
        q: "Le License Check est-il OK ?",
        opts: [
          { t: "Oui — licence valide", tone: "ok", go: "r_pass" },
          { t: "Aucune licence fournie", tone: "warn", go: "r_missing" },
          { t: "Licence expirée", tone: "warn", go: "r_expired" },
          { t: "Mauvaise licence / autre marchand / sans titulaire", tone: "warn", go: "r_wrong" },
        ],
      },
      r_blank: { result: { decision: "pass", tag: "—", internal: "Licensing : PDS Blank (ou non couvert) → aucun contrôle de licence requis.", ecw: "", action: "Continuer." }},
      r_pass: { result: { decision: "pass", tag: "—", internal: "Licensing : PDS LP, licence valide (et reviews/location OK si massage). Conforme.", ecw: "", action: "Continuer." }},
      r_dnc: { result: { decision: "reject", tag: "DNC", internal: "Licensing : PDS marqué DNC/Ban dans la LVG → rejet définitif (déterminé par Legal). Aucun chemin possible.", ecw: "Ce type de prestation ne peut pas être proposé via Groupon.", action: "Rejeter avec le tag DNC. Pour deal Metro : rejeter d'abord, puis mettre à jour le PDS." }},
      r_missing: { result: { decision: "follow", tag: "Required Licensing is Missing", internal: "Licensing : aucune licence fournie. Follow-Up.", ecw: "Lors de la revue, certaines licences requises n'ont pas été fournies. Merci de vérifier la liste des licences requises et de téléverser une copie valide de chacune pour votre établissement.", action: "Follow-Up — Required Licensing is Missing." }},
      r_expired: { result: { decision: "follow", tag: "Provided Licensing has Expired", internal: "Licensing : licence fournie expirée. Follow-Up.", ecw: "Lors de la revue, une ou plusieurs licences fournies ont expiré. Merci de téléverser une copie valide de chaque licence requise.", action: "Follow-Up — Provided Licensing has Expired." }},
      r_wrong: { result: { decision: "follow", tag: "Provided Licensing is not the Correct Licensing", internal: "Licensing : licence incorrecte / pour un autre marchand / sans titulaire indiqué. Follow-Up avec le tag précis correspondant.", ecw: "Lors de la revue, une ou plusieurs licences fournies n'étaient pas les licences requises (ou ne précisaient pas le titulaire). Merci de téléverser une copie valide de chaque licence requise.", action: "Follow-Up — choisir le tag licence précis (Not the Correct / Different Merchant / Does Not List Who)." }},
      r_nmcheck: { result: { decision: "reject", tag: "Ineligible New Merchant - New Merchant Check failed", internal: "Licensing : échec des Online Reviews & Location Checks pour un PDS high-risk (Global). Rejet.", ecw: "Après vérification, ce nouvel établissement ne remplit pas nos critères de mise en ligne pour cette catégorie.", action: "Rejeter — New Merchant Check failed." }},
    },
  };
}

// --- PDS ELIGIBILITY (Metro) ---
function pdseligTree() {
  return {
    title: "Contrôle 4 — PDS Eligibility (Metro)",
    intro: "Le deal — ou certaines options — peut-il tourner en self-service Metro ? On rescue dès qu'au moins une option est éligible.",
    sop: <>Vérifier le PDS, le service réel et chaque option dans la PDS Eligibility list. Tout inéligible → <b>rejeter D'ABORD</b> (Not Self Service PDS) puis mettre à jour le PDS (sinon le marchand ne voit pas le message). Certaines options OK → Follow-Up « Deal Details » en indiquant quoi retirer.</>,
    start: "q_elig",
    nodes: {
      q_elig: {
        q: "Combien d'options du deal sont éligibles sur Metro ?",
        opts: [
          { t: "Toutes — deal entièrement éligible", tone: "ok", go: "r_pass" },
          { t: "Certaines oui, certaines non", tone: "warn", go: "r_follow" },
          { t: "Aucune — tout le deal inéligible", tone: "danger", go: "r_reject" },
        ],
      },
      r_pass: { result: { decision: "pass", tag: "—", internal: "PDS Eligibility : toutes les options sont éligibles Metro. Conforme.", ecw: "", action: "Continuer." }},
      r_follow: { result: { decision: "follow", tag: "Deal Details", internal: "PDS Eligibility : certaines options éligibles, d'autres non. Follow-Up « Deal Details » pour rescue : indiquer précisément l'option à retirer.", ecw: "L'une des options de votre deal ne peut pas être proposée via notre programme self-service. Merci de retirer l'option suivante : [NOM DE L'OPTION]. Une fois retirée, vous pouvez resoumettre le deal.", action: "Follow-Up — Deal Details. Préciser l'option à retirer." }},
      r_reject: { result: { decision: "reject", tag: "Not Self Service PDS", internal: "PDS Eligibility : tout le deal est inéligible Metro. Rejet « Not Self Service PDS ». REJETER D'ABORD, puis mettre à jour le PDS. Marchand redirigé vers un Sales rep.", ecw: "Ce deal ne peut pas être lancé via notre programme self-service. Un commercial Groupon prendra contact pour créer le deal.", action: "Rejeter (Not Self Service PDS) PUIS mettre à jour le PDS. Envoyer l'email SF." }},
    },
  };
}

// --- WEBSITE (Metro) ---
function websiteTree() {
  return {
    title: "Contrôle 5 — Site web du marchand (Metro)",
    intro: "Contrôle rapide oui/non. Les deals Rep-Signed n'ont pas besoin de ce contrôle.",
    sop: <>Metro uniquement : le site doit <b>fonctionner</b> ET son contenu doit être <b>pertinent</b> pour le marchand et le service. Sinon → Follow-Up « Service(s) Not Listed on Merchant's Website ».</>,
    start: "q_site",
    nodes: {
      q_site: {
        q: "Le site fonctionne-t-il ET son contenu est-il pertinent (marchand + service du deal) ?",
        opts: [
          { t: "Oui — site OK et pertinent", tone: "ok", go: "r_pass" },
          { t: "Non — site cassé ou contenu non pertinent", tone: "warn", go: "r_follow" },
        ],
      },
      r_pass: { result: { decision: "pass", tag: "—", internal: "Site web : fonctionne et contenu pertinent. Conforme.", ecw: "", action: "Continuer." }},
      r_follow: { result: { decision: "follow", tag: "Service(s) Not Listed on Merchant's Website", internal: "Site web : site cassé ou non pertinent. Follow-Up.", ecw: "Certaines options incluses dans votre deal Groupon ne sont pas disponibles sur votre site. Merci de lister les services et prix sur votre site, ou de fournir un Proof of Pricing valide.", action: "Follow-Up — Service(s) Not Listed on Merchant's Website." }},
    },
  };
}

// --- GOODS INTL (brand tier + Apple + refurbished) ---
function goodsTree() {
  return {
    title: "Contrôle Goods INTL — marque, Apple & refurbished",
    intro: "Flux Goods INTL (Gazebo) en plus des contrôles cœur. NAM Goods (Gateway) n'est PAS couvert — escalader.",
    sop: <>Brand tier : T1 = scrutin max, T2/T3 ou vendeur exempté = vetter. <b>Apple</b> a un flux dédié (liste de vendeurs approuvés). Refurbished : grade A/B/C obligatoire ; si manquante → IR à Sales (≠ NAM Gateway qui rejette). Vendeurs exemptés : BVG Airflo, James Russell, E.com Intl (Home &amp; Garden), UPGS, Van Meuwen.</>,
    start: "q_brand",
    nodes: {
      q_brand: {
        q: "Le produit est-il de marque (branded) ?",
        help: <>Le système de <b>tiers de marque</b> dit le niveau de risque IP/contrefaçon que Legal a pré-établi.<br /><b>T1</b> = marques à plus fort risque → scrutin maximal (approbation ou doc de provenance requis).<br /><b>T2 / T3</b> = risque moindre → on vette.<br /><b>Vendeur exempté</b> (BVG Airflo, James Russell, E.com Intl en Home &amp; Garden, UPGS, Van Meuwen) → de confiance, on vette.<br /><b>Apple</b> = piste dédiée (liste de vendeurs approuvés), distincte du T1.<br /><br />Le tier se lit dans le champ « Brand » en SF, croisé avec la Tier Brands sheet.</>,
        opts: [
          { t: "Non — produit sans marque", tone: "ok", go: "q_refurb" },
          { t: "Oui — c'est de l'Apple", go: "q_apple" },
          { t: "Oui — T2 / T3 ou vendeur exempté", tone: "ok", go: "q_refurb" },
          { t: "Oui — marque T1 (hors Apple)", tone: "warn", go: "q_t1" },
        ],
      },
      q_apple: {
        q: "Le vendeur est-il sur la liste Apple approuvée (Tier Brands sheet, exceptions en rouge) ?",
        opts: [
          { t: "Oui — vendeur approuvé", tone: "ok", go: "q_airpods" },
          { t: "Non — vendeur non approuvé", tone: "danger", go: "r_hold_apple" },
          { t: "Produit « lookalike » AirPods (non Apple)", tone: "danger", go: "r_ip" },
        ],
      },
      q_airpods: {
        q: "S'agit-il de véritables produits Apple (provenance OK) ?",
        opts: [
          { t: "Oui — Apple authentique", tone: "ok", go: "q_refurb" },
          { t: "Lookalike / doute IP", tone: "danger", go: "r_ip" },
        ],
      },
      r_hold_apple: { result: { decision: "hold", tag: "Legal", internal: "Goods Apple : vendeur non approuvé → Legal hold pour revue de provenance avec Ops. Sales obtient la doc de provenance (factures fournisseurs / chaîne de distribution). Une fois validé, Ops ajoute le vendeur à la liste.", ecw: "Une vérification de provenance est en cours pour ce produit de marque. Merci de fournir la documentation fournisseur (factures / chaîne d'approvisionnement) via votre commercial.", action: "Legal hold + IR à Sales pour provenance. Ne pas vetter tant que Legal n'a pas validé." }},
      r_ip: { result: { decision: "escalate", tag: "Legal", internal: "Goods : produit « lookalike » Apple (non fabriqué par Apple) → flag à Legal pour infraction IP possible. NE PAS vetter comme Apple.", ecw: "", action: "Escalader à Legal (IP). Ne pas vetter comme produit Apple." }},
      q_t1: {
        q: "Y a-t-il une approbation valide dans l'Approval History OU un document de provenance attaché ? (non requis pour refurbished)",
        opts: [
          { t: "Oui — approbation ou provenance présente", tone: "ok", go: "q_refurb" },
          { t: "Produit refurbished (provenance non requise)", tone: "ok", go: "q_refurb" },
          { t: "Non — ni approbation ni provenance", tone: "warn", go: "r_hold_t1" },
        ],
      },
      r_hold_t1: { result: { decision: "ir", tag: "Legal", internal: "Goods T1 : ni approbation (Approval History par un approbateur autorisé) ni provenance doc. Deal en attente jusqu'à obtention de l'un des deux.", ecw: "Ce produit de marque nécessite une validation interne (approbation ou document de provenance) avant mise en ligne.", action: "Obtenir une approbation d'un approbateur autorisé OU un provenance doc. IR à Sales si nécessaire." }},
      q_refurb: {
        q: "Le produit est-il reconditionné (refurbished) ?",
        help: <>Un produit <b>reconditionné</b> doit afficher une <b>grade A / B / C</b> (état). Cette grade vient du vendeur, transmise par Sales.<br /><br />Si la grade <b>manque</b> : sur Goods <b>INTL</b> on ne rejette pas — on fait un IR à Sales et le deal attend en « Rep Getting Info » (le body copy devra mentionner la grade avant lancement). C'est l'<b>inverse de NAM Gateway</b>, où une grade manquante = rejet automatique.</>,
        opts: [
          { t: "Non — produit neuf", tone: "ok", go: "q_valid" },
          { t: "Oui — grade A/B/C présente", tone: "ok", go: "q_valid" },
          { t: "Oui — grade MANQUANTE", tone: "warn", go: "r_refurb_ir" },
        ],
      },
      r_refurb_ir: { result: { decision: "ir", tag: "—", internal: "Goods refurbished : grade A/B/C manquante. IR à Sales (≠ NAM Gateway qui rejette). Le deal reste en Rep Getting Info jusqu'à confirmation ; le body copy doit mentionner la grade avant lancement.", ecw: "Ce produit reconditionné doit afficher son grade de reconditionnement (A, B ou C). Merci de confirmer le grade auprès du fournisseur.", action: "IR à Sales pour la grade. Deal en Rep Getting Info. Body copy doit mentionner la grade." }},
      q_valid: {
        q: "Catégorie soumise à validation (Food/Cosmétique/Détergent) ? Les checks QA passent-ils ?",
        opts: [
          { t: "Hors scope — vetter", tone: "ok", go: "r_pass" },
          { t: "Dans le scope — checks QA OK", tone: "ok", go: "r_pass" },
          { t: "Dans le scope — vérification échouée", tone: "warn", go: "r_valid_ir" },
        ],
      },
      r_valid_ir: { result: { decision: "ir", tag: "—", internal: "Goods : catégorie en scope de validation (Food/Cosmétique/Détergent) et check QA échoué. IR (templates en colonne Y du QA matrix). Rappel : comprimés/médic. liquides ≠ food ; protein shakes = food (Food Doc requis).", ecw: "Une documentation complémentaire est requise pour cette catégorie de produit. Merci de la fournir via votre commercial.", action: "IR à Sales (voir QA check matrix)." }},
      r_pass: { result: { decision: "pass", tag: "—", internal: "Goods INTL : marque/Apple/refurbished/validation OK. Penser à la shipping proof si cross-border (pays facturation ≠ pays feature). Ignorer les attributs MRT.", ecw: "", action: "Continuer. Vérifier la shipping proof si cross-border ; ignorer les attributs MRT." }},
    },
  };
}

// Construit la liste ordonnée des contrôles pour un LoB
function buildChecks(lob, market) {
  const a = APPLIES[lob];
  const checks = [];
  if (a.dac7) checks.push({ key: "dac7", tree: dac7Tree(lob) });
  if (a.pricing) checks.push({ key: "pricing", tree: pricingTree(lob, market) });
  if (a.licensing) checks.push({ key: "licensing", tree: licensingTree(lob) });
  if (a.pdselig) checks.push({ key: "pdselig", tree: pdseligTree() });
  if (a.website) checks.push({ key: "website", tree: websiteTree() });
  if (a.goods) checks.push({ key: "goods", tree: goodsTree() });
  return checks;
}

/* =========================================================================
   Question + bulle d'aide dépliable
   ========================================================================= */
function QuestionWithHelp({ q, help }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 15.5, color: C.ink, lineHeight: 1.45, flex: 1 }}>{q}</div>
        {help && (
          <button
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            title="Que veut dire cette question ?"
            style={{
              flexShrink: 0, width: 24, height: 24, borderRadius: "50%", cursor: "pointer",
              border: `1.5px solid ${open ? C.blue : C.line}`, background: open ? C.blue : C.panel,
              color: open ? "#fff" : C.blue, fontWeight: 800, fontSize: 13, lineHeight: 1,
              fontFamily: "inherit", marginTop: 1,
            }}
          >?</button>
        )}
      </div>
      {help && open && (
        <div style={{
          background: C.blueSoft, border: `1px solid #cfe1f3`, borderRadius: 10,
          padding: "11px 14px", marginTop: 10, fontSize: 13.2, lineHeight: 1.55, color: "#1c3d5e",
        }}>
          <div style={{ fontWeight: 800, fontSize: 11, letterSpacing: 0.4, textTransform: "uppercase", marginBottom: 4, color: C.blue }}>
            Ça veut dire quoi ?
          </div>
          {help}
        </div>
      )}
    </div>
  );
}

/* =========================================================================
   Composant d'une étape de contrôle (parcourt un arbre)
   ========================================================================= */
function CheckRunner({ tree, onDone }) {
  const [nodeId, setNodeId] = useState(tree.start);
  const [trail, setTrail] = useState([]); // historique pour "Précédent"
  const node = tree.nodes[nodeId];

  // si on tombe sur un result, on remonte au parent
  React.useEffect(() => {
    if (node && node.result) {
      onDone(node.result, trail);
    }
    // eslint-disable-next-line
  }, [nodeId]);

  if (!node || node.result) {
    return null; // le résultat est géré par le parent
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 19, color: C.navy, fontWeight: 800 }}>{tree.title}</h2>
      </div>
      <p style={{ color: C.sub, fontSize: 14, lineHeight: 1.5, marginTop: 6 }}>{tree.intro}</p>
      <SopNote>{tree.sop}</SopNote>

      <div style={{ marginTop: 22 }}>
        <QuestionWithHelp q={node.q} help={node.help} />
        {node.opts.map((o, i) => (
          <Choice key={i} tone={o.tone} onClick={() => { setTrail([...trail, nodeId]); setNodeId(o.go); }}>
            {o.t}
          </Choice>
        ))}
      </div>

      {trail.length > 0 && (
        <button
          onClick={() => { const t = [...trail]; const prev = t.pop(); setTrail(t); setNodeId(prev); }}
          style={{
            marginTop: 18, background: "transparent", border: "none", color: C.blue,
            cursor: "pointer", fontSize: 13.5, fontWeight: 600, fontFamily: "inherit", padding: 0,
          }}
        >← Question précédente</button>
      )}
    </div>
  );
}

/* =========================================================================
   APP
   ========================================================================= */
const CHECK_LABEL = {
  dac7: "DAC7 / DSA", pricing: "Pricing", licensing: "Licensing",
  pdselig: "PDS Eligibility", website: "Site web", goods: "Goods INTL",
};

export default function App() {
  const [lob, setLob] = useState(null);
  const [market, setMarket] = useState(null);
  const [dealId, setDealId] = useState("");
  const [agent, setAgent] = useState("");
  const [idx, setIdx] = useState(0);
  const [results, setResults] = useState([]); // {key, title, ...result}
  const [phase, setPhase] = useState("lob"); // lob | run | summary
  const [copied, setCopied] = useState("");
  const [showPV, setShowPV] = useState(false);

  const checks = useMemo(() => (lob ? buildChecks(lob, market) : []), [lob, market]);

  function startLob(id) {
    setLob(id); setPhase("run"); setIdx(0); setResults([]);
  }

  function handleDone(result, _trail) {
    const cur = checks[idx];
    const entry = { key: cur.key, title: cur.tree.title, ...result };
    const next = [...results, entry];
    setResults(next);
    if (idx + 1 < checks.length) setIdx(idx + 1);
    else setPhase("summary");
  }

  function reset() {
    setPhase("lob"); setLob(null); setMarket(null); setIdx(0); setResults([]); setDealId(""); setCopied("");
  }
  function restartChecks() {
    setPhase("run"); setIdx(0); setResults([]); setCopied("");
  }

  // Verdict global
  const verdict = useMemo(() => {
    if (!results.length) return null;
    const has = (d) => results.some((r) => r.decision === d);
    if (has("reject")) return { d: "reject", txt: "Deal REJETÉ", kind: "danger" };
    if (has("escalate")) return { d: "escalate", txt: "Escalade Legal requise", kind: "danger" };
    if (has("hold")) return { d: "hold", txt: "Legal Hold — provenance", kind: "danger" };
    if (has("follow")) return { d: "follow", txt: "Follow-Up marchand requis", kind: "warn" };
    if (has("ir")) return { d: "ir", txt: "IR à Sales requis", kind: "warn" };
    return { d: "pass", txt: "Tous les contrôles passent — deal validé", kind: "ok" };
  }, [results]);

  // Notes générées
  const lobLabel = lob ? LOBS.find((l) => l.id === lob).label : "";
  const marketLabel = market ? (MARKETS.find((m) => m.id === market) || {}).label + " (" + market + ")" : "—";
  const dateStr = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });

  const internalNote = useMemo(() => {
    if (phase !== "summary") return "";
    let s = `NOTE DE VETTING — OneTouch\n`;
    s += `Deal : ${dealId || "[ID/Opp]"}   |   LoB : ${lobLabel}   |   Marché : ${marketLabel}\n`;
    s += `Agent : ${agent || "[nom]"}   |   Date : ${dateStr}\n`;
    s += `Verdict : ${verdict ? verdict.txt : ""}\n`;
    s += `${"-".repeat(52)}\n`;
    results.forEach((r, i) => {
      const dl = DECISIONS[r.decision].label;
      s += `${i + 1}. ${CHECK_LABEL[r.key]} — [${dl}]\n`;
      s += `   ${r.internal}\n`;
      if (r.tag && r.tag !== "—") s += `   Tag : ${r.tag}\n`;
      if (r.action) s += `   Action : ${r.action}\n`;
      s += `\n`;
    });
    s += `${"-".repeat(52)}\n`;
    s += `Rappel : le seul mauvais geste est le geste silencieux. En cas de doute → TL ou formulaire Asana SOP gap.`;
    return s;
  }, [phase, results, dealId, agent, lobLabel, marketLabel, verdict, dateStr]);

  const merchantMsg = useMemo(() => {
    if (phase !== "summary") return "";
    const ecws = results.filter((r) => r.ecw && r.ecw.trim());
    if (!ecws.length) {
      return "Aucun message marchand requis — tous les contrôles passent. Le deal peut avancer vers l'écriture.";
    }
    let s = `Bonjour,\n\nAprès vérification de votre deal, voici les points à corriger pour permettre sa mise en ligne :\n\n`;
    ecws.forEach((r, i) => {
      s += `${i + 1}. ${r.ecw}\n\n`;
    });
    s += `Une fois ces éléments corrigés, votre deal pourra être resoumis. Merci !`;
    return s;
  }, [phase, results]);

  function copy(text, which) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand("copy"); document.body.removeChild(ta);
      setCopied(which); setTimeout(() => setCopied(""), 1800);
    } catch (e) { /* noop */ }
  }

  // progress
  const total = checks.length || 1;
  const doneCount = phase === "summary" ? total : idx;

  return (
    <div style={{
      fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
      background: C.bg, minHeight: "100vh", color: C.ink, padding: "0 0 60px",
    }}>
      {/* Header */}
      <div style={{ background: C.navy, color: "#fff", padding: "20px 24px" }}>
        <div style={{ maxWidth: 820, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 12, letterSpacing: 1.5, textTransform: "uppercase", opacity: 0.7, fontWeight: 700 }}>Content Operations</div>
            <div style={{ fontSize: 22, fontWeight: 800, marginTop: 2 }}>Assistant de vetting OneTouch</div>
          </div>
          {lob && (
            <button onClick={reset} style={{
              background: "rgba(255,255,255,.12)", color: "#fff", border: "1px solid rgba(255,255,255,.25)",
              borderRadius: 8, padding: "8px 14px", cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: "inherit",
            }}>↻ Nouveau deal</button>
          )}
        </div>
      </div>

      <div style={{ maxWidth: 820, margin: "0 auto", padding: "0 20px" }}>

        {/* Progress bar */}
        {lob && (
          <div style={{ margin: "20px 0 4px" }}>
            <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
              {checks.map((c, i) => {
                const state = i < doneCount ? "done" : i === idx && phase === "run" ? "cur" : "todo";
                const r = results[i];
                const bg = state === "done"
                  ? (r ? { ok: C.ok, follow: C.warn, ir: C.warn, reject: C.danger, hold: C.danger, escalate: C.danger }[r.decision] : C.ok)
                  : state === "cur" ? C.blue : "#cdd6e0";
                return (
                  <div key={c.key} style={{ flex: 1, minWidth: 70 }}>
                    <div style={{ height: 5, background: bg, borderRadius: 3 }} />
                    <div style={{ fontSize: 10.5, color: state === "todo" ? "#9aa7b5" : C.ink, fontWeight: state === "cur" ? 700 : 500, marginTop: 5, textAlign: "center" }}>
                      {CHECK_LABEL[c.key]}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* PHASE 1 — choix LoB */}
        {phase === "lob" && (
          <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, padding: 26, marginTop: 22 }}>
            <h1 style={{ margin: 0, fontSize: 21, color: C.navy, fontWeight: 800 }}>Démarrer un vetting</h1>
            <p style={{ color: C.sub, fontSize: 14.5, lineHeight: 1.5, marginTop: 8 }}>
              Renseignez le deal, choisissez le marché puis la Ligne de Business. L'assistant vous guide contrôle par contrôle avec le rappel SOP, et génère à la fin la note interne + le message marchand.
            </p>
            <div style={{ display: "flex", gap: 12, marginTop: 16, flexWrap: "wrap" }}>
              <label style={{ flex: 1, minWidth: 200 }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: C.sub }}>ID / Opp du deal</span>
                <input value={dealId} onChange={(e) => setDealId(e.target.value)} placeholder="ex. 006xx… ou nom d'opp"
                  style={inputStyle} />
              </label>
              <label style={{ flex: 1, minWidth: 200 }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: C.sub }}>Votre nom (agent)</span>
                <input value={agent} onChange={(e) => setAgent(e.target.value)} placeholder="ex. A. Dupont"
                  style={inputStyle} />
              </label>
            </div>

            <div style={{ fontSize: 12.5, fontWeight: 700, color: C.sub, margin: "20px 0 6px" }}>
              MARCHÉ {market && <span style={{ color: C.blue }}>· {MARKETS.find((m) => m.id === market).label}</span>}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {MARKETS.map((m) => {
                const on = market === m.id;
                return (
                  <button key={m.id} onClick={() => setMarket(m.id)} style={{
                    border: `1.5px solid ${on ? C.blue : C.line}`, background: on ? C.blueSoft : C.panel,
                    color: on ? C.navy : C.ink, borderRadius: 8, padding: "8px 13px", cursor: "pointer",
                    fontSize: 13.5, fontWeight: on ? 700 : 500, fontFamily: "inherit",
                  }}>{m.label} <span style={{ opacity: 0.6, fontSize: 11.5 }}>{m.region}</span></button>
                );
              })}
            </div>

            <div style={{ fontSize: 12.5, fontWeight: 700, color: C.sub, margin: "20px 0 4px" }}>
              LIGNE DE BUSINESS {!market && <span style={{ color: C.warn, fontWeight: 600 }}>— choisissez d'abord un marché</span>}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(230px,1fr))", gap: 12, opacity: market ? 1 : 0.45, pointerEvents: market ? "auto" : "none" }}>
              {LOBS.map((l) => (
                <button key={l.id} onClick={() => startLob(l.id)} style={lobBtn}>
                  <div style={{ fontWeight: 800, fontSize: 15, color: C.navy }}>{l.label}</div>
                  <div style={{ fontSize: 12.5, color: C.sub, marginTop: 3 }}>{l.hint}</div>
                  <div style={{ fontSize: 11.5, color: C.blue, marginTop: 8, fontWeight: 600 }}>
                    {buildChecks(l.id, market).length} contrôles →
                  </div>
                </button>
              ))}
            </div>
            <button onClick={() => setShowPV(true)} style={{
              marginTop: 16, background: "transparent", border: `1.5px solid ${C.navy}`, color: C.navy,
              borderRadius: 8, padding: "9px 15px", cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: "inherit",
            }}>📋 Ouvrir la fiche Proof of Pricing</button>
            <div style={{ marginTop: 16, fontSize: 12.5, color: C.sub, background: C.dangerSoft, border: `1px solid #eccac7`, borderRadius: 8, padding: "10px 14px" }}>
              <b style={{ color: C.danger }}>NAM Goods (Gateway)</b> n'est pas couvert ici — flux séparé (équipe Murali). Si on vous le demande → escaladez.
            </div>
          </div>
        )}

        {/* PHASE 2 — parcours */}
        {phase === "run" && checks[idx] && (
          <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, padding: 26, marginTop: 18 }}>
            <div style={{ fontSize: 12.5, color: C.sub, marginBottom: 4 }}>
              {lobLabel} · contrôle {idx + 1} / {checks.length}
            </div>
            <CheckRunner key={checks[idx].key} tree={checks[idx].tree} onDone={handleDone} />
          </div>
        )}

        {/* PHASE 3 — résumé + notes */}
        {phase === "summary" && (
          <div style={{ marginTop: 18 }}>
            {/* Verdict */}
            <div style={{
              background: verdict.kind === "ok" ? C.okSoft : verdict.kind === "warn" ? C.warnSoft : C.dangerSoft,
              border: `1.5px solid ${verdict.kind === "ok" ? "#bfe0cc" : verdict.kind === "warn" ? "#ecd8a8" : "#eccac7"}`,
              borderRadius: 14, padding: "18px 22px",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <Badge kind={verdict.kind}>{DECISIONS[verdict.d].label}</Badge>
                <span style={{ fontWeight: 800, fontSize: 18, color: verdict.kind === "ok" ? C.ok : verdict.kind === "warn" ? C.warn : C.danger }}>
                  {verdict.txt}
                </span>
              </div>
              <div style={{ fontSize: 13, color: C.sub, marginTop: 8 }}>
                {dealId || "[deal]"} · {lobLabel} · {results.length} contrôles exécutés
              </div>
            </div>

            {/* Tableau récap */}
            <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, padding: 20, marginTop: 16 }}>
              <h2 style={{ margin: "0 0 12px", fontSize: 16, color: C.navy, fontWeight: 800 }}>Récapitulatif des contrôles</h2>
              {results.map((r, i) => (
                <div key={i} style={{ display: "flex", gap: 12, padding: "11px 0", borderTop: i ? `1px solid ${C.line}` : "none" }}>
                  <div style={{ minWidth: 110 }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5 }}>{CHECK_LABEL[r.key]}</div>
                    <div style={{ marginTop: 4 }}><Badge kind={DECISIONS[r.decision].kind}>{DECISIONS[r.decision].label}</Badge></div>
                  </div>
                  <div style={{ fontSize: 13, color: C.sub, lineHeight: 1.5, flex: 1 }}>
                    {r.action}
                    {r.tag && r.tag !== "—" && <div style={{ marginTop: 3, color: C.ink }}><b>Tag :</b> {r.tag}</div>}
                  </div>
                </div>
              ))}
            </div>

            {/* Note interne */}
            <NoteCard
              title="Note interne (à ajouter à l'offre)"
              subtitle="Récapitulatif par contrôle + décisions et actions."
              text={internalNote}
              copied={copied === "internal"}
              onCopy={() => copy(internalNote, "internal")}
            />

            {/* Message marchand */}
            <NoteCard
              title="Message marchand (ECW)"
              subtitle={merchantMsg.startsWith("Aucun") ? "Aucune correction marchand requise." : "Assemblé à partir des Follow-Up / IR. Remplacez les [crochets] avant envoi."}
              text={merchantMsg}
              copied={copied === "merchant"}
              onCopy={() => copy(merchantMsg, "merchant")}
              accent={merchantMsg.startsWith("Aucun") ? C.ok : C.blue}
            />

            <div style={{ display: "flex", gap: 12, marginTop: 18, flexWrap: "wrap" }}>
              <button onClick={restartChecks} style={ghostBtn}>↻ Refaire les contrôles</button>
              <button onClick={reset} style={primaryBtn}>Nouveau deal</button>
            </div>
          </div>
        )}
      </div>

      {/* Bouton flottant Fiche PV (visible pendant le parcours) */}
      {phase !== "lob" && (
        <button onClick={() => setShowPV(true)} style={{
          position: "fixed", right: 18, bottom: 18, zIndex: 40,
          background: C.navy, color: "#fff", border: "none", borderRadius: 24,
          padding: "12px 18px", cursor: "pointer", fontSize: 13.5, fontWeight: 700,
          fontFamily: "inherit", boxShadow: "0 4px 14px rgba(0,0,0,.22)",
        }}>📋 Fiche PV</button>
      )}

      {showPV && <PVReference market={market} onClose={() => setShowPV(false)} />}
    </div>
  );
}

function PVReference({ market, onClose }) {
  const mLabel = market ? (MARKETS.find((m) => m.id === market) || {}).label : "tous marchés";
  const Row = ({ h, children }) => (
    <div style={{ padding: "11px 0", borderTop: `1px solid ${C.line}` }}>
      <div style={{ fontWeight: 800, fontSize: 13.5, color: C.navy }}>{h}</div>
      <div style={{ fontSize: 13, color: C.sub, lineHeight: 1.55, marginTop: 4 }}>{children}</div>
    </div>
  );
  const hl = (txt) => <b style={{ color: C.ink }}>{txt}</b>;
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(16,24,33,.55)", zIndex: 60,
      display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "5vh 16px", overflowY: "auto",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: C.panel, borderRadius: 16, maxWidth: 720, width: "100%", padding: 24,
        boxShadow: "0 20px 50px rgba(0,0,0,.3)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 19, color: C.navy, fontWeight: 800 }}>Fiche Proof of Pricing</h2>
            <div style={{ fontSize: 12.5, color: C.sub, marginTop: 3 }}>Référence rapide · marché : {mLabel}</div>
          </div>
          <button onClick={onClose} style={{
            background: C.bg, border: "none", borderRadius: 8, width: 34, height: 34,
            cursor: "pointer", fontSize: 18, color: C.sub, fontFamily: "inherit",
          }}>×</button>
        </div>

        <div style={{ marginTop: 8 }}>
          <Row h="Quand un PV est-il requis ?">
            NAM &amp; CA Local (non-Metro) : {hl("remise ≥ 40 %")}. Getaways &amp; National : dès qu'il y a une remise.
            Travel Booking / Hotel Trader : {hl("pas de PV")}. Extranet : un PV par add-on inclus. Voucher : nuitée + chaque add-on.
            GLive : tenter ; sinon pousser sans IR. Goods : dès qu'il y a une remise (Unit Value ≤ PV).
          </Row>
          <Row h="Validité d'un screenshot de site">
            {hl("< 30 jours")} + {hl("timestamp")} + {hl("URL")} visibles. Si capture absente/incorrecte mais bon prix sur le site → l'agent CO prend lui-même la capture et l'attache.
          </Row>
          <Row h="Autres justificatifs acceptés">
            Reçu / facture {hl("< 3 mois")} · Menu / liste de prix (pas d'expiration pour les services ; {hl("Goods : DE/ES 6 mois, autres 12 mois")}) · Price breakdown pour les packages (hors Goods) · LiveNation Tour Docs (NAM GLive).
            Doit inclure logo, nom OU adresse du marchand.
          </Row>
          <Row h="Formats">
            Uniquement {hl(".pdf, .png, .jpeg")}. Pas de {hl(".doc / .xlsx / .txt")} ni d'éditable.
          </Row>
          <Row h="Identité marchand manquante">
            Acceptable si on a la preuve que le marchand a envoyé le doc (capture de l'email), avec nom/adresse/logo dans la signature. Une {hl("simple confirmation par email n'est PAS un PV valide")}.
          </Row>
          <Row h="Manuscrit">
            Dernier recours uniquement. {market === "FR"
              ? <span style={{ color: C.danger, fontWeight: 700 }}>Interdit en France.</span>
              : "Accepté seulement si aucune autre preuve possible (interdit en France)."}
          </Row>
          <Row h="Bottomless drinks">
            {noDrinkInRef(market)
              ? <span style={{ color: C.ink }}>Sur ce marché (FR/BE/NL) : {hl("aucun prix de boisson")} dans le prix de référence.</span>
              : <>Valeur basée sur les {hl("3 boissons les plus chères")} incluses ; thé illimité = {hl("2 théières max")}.</>}
            {" "}Espagne : si le PV n'inclut pas les boissons, on peut quand même montrer une remise raisonnable.
          </Row>
          <Row h="Conversion de devise (Local / Live / National)">
            Convertir via Google Converter en devise locale, {hl("±5 % toléré")}, capture de la conversion attachée. PV Travel : devise du pays du partenaire.
          </Row>
          <Row h="Best practice pro-rata">
            Pro-rata autorisé (ex. 30 min → 60 min) sauf {hl("en France")}. FR : on peut multiplier par la quantité (1×60 min → 3×60 min) mais {hl("pas de pro-rata")}.
          </Row>
        </div>

        <button onClick={onClose} style={{ ...primaryBtn, marginTop: 18 }}>Fermer</button>
      </div>
    </div>
  );
}

function NoteCard({ title, subtitle, text, onCopy, copied, accent = C.navy }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, padding: 20, marginTop: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 16, color: accent, fontWeight: 800 }}>{title}</h2>
          <div style={{ fontSize: 12.5, color: C.sub, marginTop: 3 }}>{subtitle}</div>
        </div>
        <button onClick={onCopy} style={{
          background: copied ? C.ok : accent, color: "#fff", border: "none", borderRadius: 8,
          padding: "9px 16px", cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: "inherit", whiteSpace: "nowrap",
        }}>{copied ? "✓ Copié" : "Copier"}</button>
      </div>
      <pre style={{
        marginTop: 14, background: "#f7f9fb", border: `1px solid ${C.line}`, borderRadius: 10,
        padding: "14px 16px", fontSize: 12.8, lineHeight: 1.55, color: C.ink, whiteSpace: "pre-wrap",
        fontFamily: "'SF Mono', ui-monospace, 'Cascadia Code', Consolas, monospace", overflowX: "auto",
      }}>{text}</pre>
    </div>
  );
}

const inputStyle = {
  display: "block", width: "100%", boxSizing: "border-box", marginTop: 5,
  border: `1.5px solid ${C.line}`, borderRadius: 8, padding: "10px 12px",
  fontSize: 14, fontFamily: "inherit", color: C.ink, outline: "none",
};
const lobBtn = {
  textAlign: "left", background: C.panel, border: `1.5px solid ${C.line}`, borderRadius: 12,
  padding: "16px 18px", cursor: "pointer", fontFamily: "inherit", transition: "border-color .12s",
};
const primaryBtn = {
  background: C.navy, color: "#fff", border: "none", borderRadius: 9, padding: "11px 20px",
  cursor: "pointer", fontSize: 14, fontWeight: 700, fontFamily: "inherit",
};
const ghostBtn = {
  background: "transparent", color: C.navy, border: `1.5px solid ${C.navy}`, borderRadius: 9,
  padding: "11px 20px", cursor: "pointer", fontSize: 14, fontWeight: 700, fontFamily: "inherit",
};
