const fs = require('fs');
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
        Header, Footer, AlignmentType, HeadingLevel, BorderStyle, WidthType,
        ShadingType, PageNumber, PageBreak, LevelFormat } = require('docx');

const border = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
const borders = { top: border, bottom: border, left: border, right: border };
const cellMargins = { top: 60, bottom: 60, left: 100, right: 100 };

function headerCell(text, width) {
  return new TableCell({
    borders, width: { size: width, type: WidthType.DXA },
    shading: { fill: "1a1a1a", type: ShadingType.CLEAR },
    margins: cellMargins,
    children: [new Paragraph({ children: [new TextRun({ text, bold: true, font: "Arial", size: 18, color: "c9920d" })] })]
  });
}

function cell(text, width) {
  return new TableCell({
    borders, width: { size: width, type: WidthType.DXA },
    margins: cellMargins,
    children: [new Paragraph({ children: [new TextRun({ text, font: "Arial", size: 18 })] })]
  });
}

function h1(text) {
  return new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 200 },
    children: [new TextRun({ text, bold: true, font: "Syne", size: 36, color: "c9920d" })] });
}

function h2(text) {
  return new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 300, after: 150 },
    children: [new TextRun({ text, bold: true, font: "Arial", size: 28 })] });
}

function h3(text) {
  return new Paragraph({ spacing: { before: 200, after: 100 },
    children: [new TextRun({ text, bold: true, font: "Arial", size: 22 })] });
}

function p(text) {
  return new Paragraph({ spacing: { after: 80 },
    children: [new TextRun({ text, font: "Arial", size: 20 })] });
}

function bullet(text, ref) {
  return new Paragraph({ numbering: { reference: ref, level: 0 }, spacing: { after: 60 },
    children: [new TextRun({ text, font: "Arial", size: 20 })] });
}

function divider() {
  return new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "c9920d", space: 1 } },
    spacing: { before: 200, after: 200 }, children: [new TextRun("")] });
}

// Target data
const targets = [
  ["1","@RoundtableSpace","0xMarioNawfal","220.6K","Crypto & AI podcast","Yes","WHALE"],
  ["2","@IAPolls2022","IAPolls","235.5K","PM aggregator","?","WHALE"],
  ["3","@Hesamation","hesam","73.2K","AI/ML creator","Yes","WHALE"],
  ["4","@PolymarketSport","PM Sports","58.5K","Sports PM","?","HIGH"],
  ["5","@TheDoctorGamble","TheDoctor","56K","Casino/Gaming","Yes","HIGH"],
  ["6","@PolymarketTrade","PM Trade","45.7K","Community + TG","?","HIGH"],
  ["7","@Domahhhh","Domer","35.9K","Top trader (+$2.8M)","Yes","HIGH"],
  ["8","@PredMTrader","PredMTrader","28.1K","Daily streamer","?","HIGH"],
  ["9","@BlankBrainTrade","blank","25.8K","Copy trading","Yes","HIGH"],
  ["10","@PolymarketStory","PolymarketHistory","24.1K","PM commentary","No","HIGH"],
  ["11","@AnselFang","Ansel","10.1K","+$3.1M PnL","Yes","HIGH"],
  ["12","@danblocmates","dan blocmates","10.4K","Alpha newsletter","Yes","HIGH"],
  ["13","@lookonchain","Lookonchain","10K+","Whale tracking","Yes","HIGH"],
  ["14","@willoptions","will.js","9K","Trading terminals","Yes","MED"],
  ["15","@polydao","Mr. Buzzoni","9K","PM researcher","Yes","HIGH"],
  ["16","@kirillk_web3","Kirill","8.1K","PM Maxi, bots","Yes","MED"],
  ["17","@zostaff","zostaff","6.8K","Arb bot builder","Yes","MED"],
  ["18","@0xMovez","Movez","6.7K","PM content","Yes","MED"],
  ["19","@PhilMrlo","Hix0n blocmates","6.1K","Alpha newsletter","Yes","MED"],
  ["20","@HarveyMackinto2","YatSen","5.5K","+$2.3M PnL","Yes","MED"],
  ["21","@0x8dxd","0X8DXD","5.3K","Top 30 trader","No","MED"],
  ["22","@Finch_in_flight","Finch","4.9K","Crypto theses","Yes","MED"],
  ["23","@adiix_official","AdiiX","4.3K","Crypto/PM","Yes","MED"],
  ["24","@aenews","AE News","3.9K","Multi-platform","Yes","MED"],
  ["25","@ProMint_X","ProMint","3.8K","Invest community","?","MED"],
  ["26","@pvpterminal","PvP Terminal","3.5K","Event trading sw","Yes","MED"],
  ["27","@0xRicker","0xRicker","3K","PM researcher","Yes","MED"],
  ["28","@ultra_taker","ultra_taker","~2K","PM analyst","Yes","LOW"],
  ["29","@seelffff","self.dll","?","ALREADY CONNECTED","Yes","ACTIVE"],
  ["30","@surgence_io","Surgence Labs","?","PM infra","?","MED"],
];

// Pitches
const pitches = [
  { title: "PITCH 1 - @Domahhhh (Domer) - 35.9K followers", body: "Hey Domer \u2014 18 years of professional betting and +$2.8M on Polymarket. Not many people can say that.\n\nI'm building HYPERFLEX (hyperflex.network) \u2014 AI market intel for prediction markets. Whale tracking, signals, screener, and a copy bot that auto-executes trades in seconds.\n\nWe're partnering with top traders and the deal is simple:\n\n- Free Premium ($99/mo value) \u2014 everything we offer, on the house\n- Featured trader profile with your verified on-chain record\n- $25/mo for every active Premium subscriber you refer. With 36K followers, even a 1-2% conversion = $9K-18K/mo passive income\n\nNo extra work needed. We showcase your track record, you share your link when you feel like it. Your audience already wants to know what you're betting on \u2014 we just make it actionable for them.\n\nHappy to keep it async or hop on a quick call. Either way." },
  { title: "PITCH 2 - @0x8dxd (0X8DXD) - 5.3K followers (DMs CLOSED)", body: "Hey 0X8DXD \u2014 saw your post about needing bots for Polymarket execution. We literally built that.\n\nI'm building HYPERFLEX (hyperflex.network) \u2014 AI-powered prediction market intel with a copy bot that auto-mirrors whale trades in seconds, plus full API access for programmatic execution.\n\nYou're top 30 all-time on Polymarket (+$2.4M). Here's what we're offering:\n\n- Free Premium ($99/mo value) \u2014 copy bot, backtester, API, real-time alerts\n- Featured on our Predictors page with your verified on-chain track record\n- $25/mo per active Premium subscriber you refer\n\nInterested?" },
  { title: "PITCH 3 - @aenews (AE News) - 3.9K followers", body: "Hey AE \u2014 you're one of the few traders active across Polymarket, Kalshi, AND PredictIt.\n\nI'm building HYPERFLEX (hyperflex.network) \u2014 AI prediction market intelligence. Whale tracking, alpha signals, copy bot, screener.\n\n- Free Premium ($99/mo)\n- Featured profile on our Predictors page\n- $25/mo recurring per Premium subscriber you refer\n\nWorth a conversation?" },
  { title: "PITCH 4 - @AnselFang - 10.1K followers (Chinese)", body: "Hi Ansel \u2014 $3.1M profit, top ROI.\n\nHYPERFLEX (hyperflex.network) \u2014 AI prediction market platform. Whale tracking, signals, copy bot.\n\n- Free Premium ($99/mo)\n- Featured trader profile\n- $25/mo per subscriber you refer. 10K followers, 1% = $2,500/mo passive income\n\nInterested?" },
  { title: "PITCH 5 - @HarveyMackinto2 (YatSen) - 5.5K followers (Chinese)", body: "YatSen \u2014 $2.3M PnL, $335M volume.\n\nHYPERFLEX (hyperflex.network) \u2014 AI prediction market platform.\n\n- Free Premium ($99/mo)\n- Featured trader profile\n- $25/mo per subscriber you refer" },
  { title: "PITCH 6 - @lookonchain - Whale tracking influencer", body: "Hey Lookonchain \u2014 your Polymarket whale threads consistently go viral. We automated what you do manually.\n\nHYPERFLEX (hyperflex.network) tracks $161M+ in whale positions in real-time.\n\n- Free Premium access for your research\n- Early access to our whale data API\n- $25/mo per Premium subscriber you refer" },
  { title: "PITCH 7 - @ultra_taker - PM analyst", body: "Hey Taker \u2014 your RN1 breakdown was one of the best Polymarket threads out there.\n\nWe built HYPERFLEX (hyperflex.network) to make that kind of analysis real-time and actionable.\n\nFree Premium + $25/mo per subscriber you refer.\n\nQuick DM or call?" },
  { title: "PITCH 8 - @zostaff - 6.8K followers, arb bot builder", body: "Hey zostaff \u2014 your arb bot thread ($100 to $5.2K in 24 hours) was insane. 65K views.\n\nWe built HYPERFLEX (hyperflex.network) \u2014 AI prediction market intelligence. Your arb bot + our real-time data layer would be a ridiculous combo.\n\n- Free Premium ($99/mo) \u2014 full API access\n- $25/mo per active Premium subscriber you refer\n\nLet's stack together." },
  { title: "PITCH 9 - @0xMovez (Movez) - 6.7K followers", body: "Hey Movez \u2014 Polymarket believer and prediction arc member.\n\nWe built HYPERFLEX (hyperflex.network) \u2014 AI-powered whale tracking, copy bot, screener, and signals.\n\n- Free Premium ($99/mo)\n- $25/mo per active Premium subscriber you refer\n- We can collab on research threads\n\nInterested?" },
  { title: "PITCH 10 - @willoptions (will.js) - 9K followers", body: "Hey will \u2014 you're building PvP Terminal. We built HYPERFLEX for the same market.\n\nTwo ways this could work:\n1. Integration play \u2014 pipe our whale data into PvP Terminal\n2. Referral partnership \u2014 $25/mo per subscriber you refer\n\nWorth a convo?" },
  { title: "PITCH 11 - @kirillk_web3 (Kirill) - 8.1K followers", body: "Hey Kirill \u2014 your entire brand is Polymarket wallet flows and copy trading. That's literally what we built.\n\nHYPERFLEX (hyperflex.network) \u2014 AI whale tracking ($161M+), copy bot, screener.\n\n- Free Premium ($99/mo) \u2014 full API access for your bots\n- $25/mo per subscriber you refer\n- We can feature your Moon Dev bots on our platform\n\nLet's build." },
  { title: "PITCH 12 - @PhilMrlo (Hix0n blocmates) - 6.1K followers", body: "Hey Hix0n \u2014 your blocmates newsletter is one of the better alpha aggregation plays.\n\nHYPERFLEX (hyperflex.network) tracks $161M+ in whale positions in real-time.\n\n- Free Premium ($99/mo)\n- $25/mo per active Premium subscriber you refer\n- Exclusive whale data for your newsletter\n\nDown to chat?" },
  { title: "PITCH 13 - @pvpterminal (PvP Terminal) - 3.5K followers", body: "Hey PvP Terminal \u2014 we built HYPERFLEX (hyperflex.network) \u2014 AI prediction market intelligence.\n\nInstead of competing, let's integrate:\n- We provide real-time Polymarket whale data via API\n- You surface it in your desktop terminal\n- $25/mo per Premium subscriber driven through your platform\n\nInterested?" },
  { title: "PITCH 14 - @Hesamation (hesam) - 73.2K followers", body: "Hey Hesam \u2014 your thread on the Claude bot making $385K on Polymarket went massive. That's exactly what we're building infrastructure for.\n\nHYPERFLEX (hyperflex.network) \u2014 AI prediction market intelligence. Real-time whale tracking ($161M+), copy bot, screener.\n\nWith 73K followers:\n- Free Premium ($99/mo)\n- $25/mo per subscriber you refer. 1% of your audience = $18K/mo\n- Co-create content \u2014 your AI expertise + our live data\n\nWorth exploring?" },
  { title: "PITCH 15 - @BlankBrainTrade (blank) - 25.8K followers", body: "Hey blank \u2014 your whole brand is copy trading. 574% CAGR. We built the prediction market version.\n\nHYPERFLEX (hyperflex.network) \u2014 AI-powered copy bot for Polymarket.\n\n- Free Premium ($99/mo)\n- $25/mo per subscriber you refer. 26K copy trading followers = insane conversion\n- Featured on our Predictors page\n\nDown?" },
  { title: "PITCH 16 - @PolymarketStory - 24.1K followers (DMs may be closed)", body: "Hey PolymarketHistory \u2014 your content IS our product in text form.\n\nWe built HYPERFLEX (hyperflex.network) \u2014 the live version of what you post.\n\n- Free Premium ($99/mo)\n- $25/mo per subscriber you refer\n- Exclusive early access to our data\n\nLet's talk." },
  { title: "PITCH 17 - @danblocmates - 10.4K followers", body: "Hey dan \u2014 blocmates is one of the OG alpha aggregation brands.\n\nHYPERFLEX (hyperflex.network) tracks $161M+ in Polymarket whale positions in real-time.\n\n- Free Premium ($99/mo)\n- $25/mo per subscriber you refer\n- Exclusive whale intelligence for your newsletter\n\nWorth a DM?" },
  { title: "PITCH 18 - @Finch_in_flight (Finch) - 4.9K followers", body: "Hey Finch \u2014 your crypto theses consistently get engagement.\n\nHYPERFLEX (hyperflex.network) is AI-powered prediction market intelligence.\n\n- Free Premium ($99/mo)\n- $25/mo per subscriber you refer\n\nInterested?" },
  { title: "PITCH 19 - @polydao (Mr. Buzzoni) - 9K followers", body: "Hey Buzzoni \u2014 \"partnerships welcome, DMs always open.\" You made this too easy.\n\nHYPERFLEX (hyperflex.network) \u2014 AI prediction market intelligence.\n\n- Free Premium ($99/mo)\n- $25/mo per subscriber you refer. 20M+ impressions in 5 months\n- Co-create content\n\nLet's stack." },
  { title: "PITCH 20 - @RoundtableSpace (0xMarioNawfal) - 220.6K followers", body: "Hey Mario \u2014 your thread on the $3M Polymarket wallet copy trader hit 67K views. That exact problem is what we built.\n\nHYPERFLEX (hyperflex.network) is AI-powered prediction market intelligence.\n\n- Free Premium ($99/mo)\n- $25/mo per subscriber you refer\n- Happy to come on Roundtable to demo live\n\nWorth a quick chat?" },
  { title: "PITCH 21 - @TheDoctorGamble (TheDoctor) - 56K followers", body: "Hey Doctor \u2014 56K followers of degens. Prediction markets are the next evolution of betting.\n\nHYPERFLEX (hyperflex.network) \u2014 AI-powered prediction market tools. Copy bot, whale tracking, signals.\n\n- Free Premium ($99/mo)\n- $25/mo per subscriber you refer. 0.5% conversion = $7K/mo\n- Custom content for your Discord/Kick community\n\nDown to explore?" },
  { title: "PITCH 22 - @seelffff (self.dll) - ALREADY CONNECTED", body: "Ayy glad you're down. Here's what we're thinking:\n\nWe built HYPERFLEX (hyperflex.network) \u2014 AI-powered prediction market tools.\n\nThe deal is simple: we give you a referral link, every Premium subscriber ($99/mo) that signs up through you = $25/mo in your pocket, recurring.\n\nFree Premium access for you too obviously.\n\nLmk if you want the link set up" },
];

// Build table rows
const colWidths = [500, 1800, 1600, 900, 1800, 600, 900];
const tableWidth = colWidths.reduce((a,b) => a+b, 0);

const headerRow = new TableRow({
  children: ["#","Handle","Name","Followers","Type","DMs","Priority"].map((h,i) => headerCell(h, colWidths[i]))
});

const dataRows = targets.map(row =>
  new TableRow({ children: row.map((val, i) => cell(val, colWidths[i])) })
);

// Build pitch paragraphs
const pitchSections = [];
pitches.forEach((pitch, idx) => {
  pitchSections.push(divider());
  pitchSections.push(h2(pitch.title));
  pitch.body.split('\n\n').forEach(para => {
    if (para.startsWith('- ')) {
      para.split('\n').forEach(line => {
        pitchSections.push(bullet(line.replace(/^- /, ''), "bullets"));
      });
    } else if (/^\d+\./.test(para)) {
      para.split('\n').forEach(line => {
        pitchSections.push(bullet(line.replace(/^\d+\.\s*/, ''), "numbers"));
      });
    } else {
      pitchSections.push(p(para));
    }
  });
});

const doc = new Document({
  numbering: {
    config: [
      { reference: "bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: "numbers", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: "tier", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
    ]
  },
  styles: {
    default: { document: { run: { font: "Arial", size: 20 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 36, bold: true, font: "Arial", color: "c9920d" },
        paragraph: { spacing: { before: 400, after: 200 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 28, bold: true, font: "Arial" },
        paragraph: { spacing: { before: 300, after: 150 }, outlineLevel: 1 } },
    ]
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1200, right: 1200, bottom: 1200, left: 1200 }
      }
    },
    headers: {
      default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT,
        children: [new TextRun({ text: "HYPERFLEX Outreach Playbook", font: "Arial", size: 16, color: "c9920d", italics: true })] })] })
    },
    footers: {
      default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: "Page ", font: "Arial", size: 16 }), new TextRun({ children: [PageNumber.CURRENT], font: "Arial", size: 16 }),
          new TextRun({ text: " | hyperflex.network | Confidential", font: "Arial", size: 16, color: "999999" })] })] })
    },
    children: [
      // Title
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 100 },
        children: [new TextRun({ text: "HYPERFLEX", font: "Syne", size: 56, bold: true, color: "c9920d" })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 100 },
        children: [new TextRun({ text: "Outreach Targets & Pitches", font: "Arial", size: 32, bold: true })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 300 },
        children: [new TextRun({ text: "Last updated: March 29, 2026", font: "Arial", size: 20, color: "888888" })] }),
      divider(),

      // Master target list
      h1("MASTER TARGET LIST (30 Accounts)"),
      p("Total potential reach: ~950K+ followers"),
      new Paragraph({ spacing: { after: 100 }, children: [] }),
      new Table({
        width: { size: tableWidth, type: WidthType.DXA },
        columnWidths: colWidths,
        rows: [headerRow, ...dataRows]
      }),

      new Paragraph({ children: [new PageBreak()] }),

      // Standard offer
      h1("STANDARD OFFER (ALL PARTNERS)"),
      bullet("Free Premium access ($99/mo value)", "bullets"),
      bullet("$25/mo recurring per active Premium subscriber referred", "bullets"),
      bullet("Featured trader profile on Predictors page (for traders)", "bullets"),
      divider(),

      // All pitches
      h1("ALL PITCHES (22 PERSONALIZED DMs)"),
      ...pitchSections,

      new Paragraph({ children: [new PageBreak()] }),

      // Priority order
      h1("OUTREACH PRIORITY ORDER"),
      h2("Tier 1 \u2014 Send ASAP (highest ROI)"),
      bullet("@seelffff \u2014 ALREADY SAID YES, close the deal", "tier"),
      bullet("@Domahhhh \u2014 35.9K, top trader, verified", "tier"),
      bullet("@Hesamation \u2014 73.2K, AI x PM intersection", "tier"),
      bullet("@BlankBrainTrade \u2014 25.8K, copy trading brand", "tier"),
      bullet("@polydao \u2014 9K, literally says \"partnerships welcome\"", "tier"),
      bullet("@kirillk_web3 \u2014 8.1K, Polymarket Maxi", "tier"),

      h2("Tier 2 \u2014 High value, send this week"),
      bullet("@RoundtableSpace \u2014 220.6K (whale, harder to land)", "tier"),
      bullet("@TheDoctorGamble \u2014 56K gambling audience", "tier"),
      bullet("@PolymarketStory \u2014 24.1K (DMs closed, reply to tweet)", "tier"),
      bullet("@danblocmates \u2014 10.4K alpha newsletter", "tier"),
      bullet("@AnselFang \u2014 10.1K, +$3.1M PnL", "tier"),
      bullet("@lookonchain \u2014 whale tracking influencer", "tier"),

      h2("Tier 3 \u2014 Good targets, send when ready"),
      bullet("@willoptions, @zostaff, @0xMovez, @PhilMrlo, @HarveyMackinto2, @Finch_in_flight, @pvpterminal, @aenews", "tier"),

      h2("Tier 4 \u2014 Bonus targets"),
      bullet("@adiix_official, @ProMint_X, @0xRicker, @ultra_taker, @0x8dxd, @PolymarketSport, @PolymarketTrade, @PredMTrader, @IAPolls2022, @surgence_io", "tier"),

      divider(),

      // Revenue projections
      h1("REVENUE PROJECTIONS"),
      h3("Conservative: 10 partners x 50 subs each"),
      bullet("500 Premium subscribers", "bullets"),
      bullet("500 x $99/mo = $49,500/mo revenue", "bullets"),
      bullet("500 x $25/mo = $12,500/mo payouts", "bullets"),
      bullet("Net: $37,000/mo", "bullets"),

      h3("Optimistic: 5 big accounts x 200 subs each"),
      bullet("1,000 Premium subscribers", "bullets"),
      bullet("1,000 x $99/mo = $99,000/mo revenue", "bullets"),
      bullet("1,000 x $25/mo = $25,000/mo payouts", "bullets"),
      bullet("Net: $74,000/mo", "bullets"),
    ]
  }]
});

Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync("/Users/marcdems/Desktop/HYPERFLEX/outreach_targets_and_pitches.docx", buffer);
  console.log("DONE: outreach_targets_and_pitches.docx created");
});
