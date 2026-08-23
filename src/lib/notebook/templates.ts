/**
 * Experiment notebook templates.
 *
 * A template is a typed field list plus a Markdown body. Rendering is pure
 * string substitution with no model call, so a saved template produces the
 * same notebook every time and works offline.
 */

export type FieldType = "text" | "textarea" | "number" | "date" | "select" | "list";

export interface TemplateField {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  placeholder?: string;
  /** For `select`. */
  options?: string[];
  /** Default value, applied when the field is left blank. */
  defaultValue?: string;
  help?: string;
}

export interface NotebookTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  fields: TemplateField[];
  /** Markdown with {{key}} placeholders and {{#each list}} blocks. */
  body: string;
}

/** Values captured for one notebook entry. */
export type TemplateValues = Record<string, string | string[] | number | null | undefined>;

const COMMON_FIELDS: TemplateField[] = [
  { key: "experiment_date", label: "実験日", type: "date", required: true },
  {
    key: "experiment_time",
    label: "記録時刻",
    type: "text",
    placeholder: "例: 09:30",
    help: "実験開始または記録した時刻",
  },
  { key: "operator", label: "担当者", type: "text", required: true },
  { key: "experiment_name", label: "実験名", type: "text", required: true },
  { key: "purpose", label: "目的", type: "textarea" },
  { key: "results", label: "結果", type: "textarea", help: "その日の観察・測定結果" },
  { key: "discussion", label: "考察", type: "textarea" },
  {
    key: "tomorrow_plan",
    label: "明日の予定",
    type: "textarea",
    placeholder: "次に行う実験・確認事項",
  },
];

export const BUILT_IN_TEMPLATES: NotebookTemplate[] = [
  {
    id: "generic",
    name: "汎用実験ノート",
    description: "目的、材料、手順、結果を書く汎用テンプレート。",
    category: "汎用",
    fields: [
      ...COMMON_FIELDS,
      { key: "sample_count", label: "サンプル数", type: "number" },
      { key: "reagents", label: "試薬（1行に1つ: 名前, Lot）", type: "list" },
      { key: "procedure", label: "手順", type: "list" },
      { key: "notes", label: "備考", type: "textarea" },
    ],
    body: `# {{experiment_date}} {{experiment_name}}

**記録時刻:** {{experiment_time}}
**担当:** {{operator}}
**目的:** {{purpose}}
**サンプル数:** {{sample_count}}

## 使用試薬
{{#each reagents}}
- {{.}}
{{/each}}

## 実施内容
{{#each procedure}}
1. {{.}}
{{/each}}

## 結果
{{results}}

## 考察
{{discussion}}

## 明日の予定
{{tomorrow_plan}}

## 備考
{{notes}}

## 添付ファイル
`,
  },
  {
    id: "tmt-labeling",
    name: "TMT標識",
    description: "チャネルごとのLot追跡付きのアイソバリック標識。",
    category: "プロテオミクス",
    fields: [
      ...COMMON_FIELDS,
      { key: "sample_count", label: "サンプル数", type: "number", defaultValue: "6" },
      { key: "trypsin_lot", label: "Trypsin Lot", type: "text" },
      { key: "tmt_lot", label: "TMT試薬 Lot", type: "text" },
      { key: "tmt_plex", label: "TMT plex", type: "select", options: ["6plex", "10plex", "11plex", "16plex", "18plex"], defaultValue: "10plex" },
      { key: "digestion_time", label: "消化時間（h）", type: "number", defaultValue: "16" },
      { key: "channels", label: "チャネル割当", type: "list" },
      { key: "procedure", label: "手順", type: "list" },
      { key: "notes", label: "備考", type: "textarea" },
    ],
    body: `# {{experiment_date}} {{experiment_name}}

**記録時刻:** {{experiment_time}}
**担当:** {{operator}}
**目的:** {{purpose}}
**サンプル数:** {{sample_count}}
**TMT plex:** {{tmt_plex}}

## 使用試薬
- Trypsin — Lot: {{trypsin_lot}}
- TMT試薬 — Lot: {{tmt_lot}}

## チャネル割当
{{#each channels}}
- {{.}}
{{/each}}

## 実施内容
{{#each procedure}}
1. {{.}}
{{/each}}

## 結果
{{results}}

## 考察
{{discussion}}

## 明日の予定
{{tomorrow_plan}}

## 備考
{{notes}}
`,
  },
  {
    id: "cell-treatment",
    name: "細胞刺激実験",
    description: "用量と検出を含む刺激の時系列実験。",
    category: "細胞生物学",
    fields: [
      ...COMMON_FIELDS,
      { key: "cell_type", label: "細胞", type: "text" },
      { key: "passage", label: "継代数", type: "text" },
      { key: "stimulus", label: "刺激", type: "text" },
      { key: "concentration", label: "濃度", type: "text" },
      { key: "duration", label: "処理時間", type: "text" },
      { key: "readout", label: "解析", type: "text" },
      { key: "conditions", label: "条件", type: "list" },
      { key: "notes", label: "備考", type: "textarea" },
    ],
    body: `# {{experiment_date}} {{experiment_name}}

**記録時刻:** {{experiment_time}}
**担当:** {{operator}}
**目的:** {{purpose}}

## 細胞
- 種類: {{cell_type}}
- 継代: {{passage}}

## 処理
- 刺激: {{stimulus}}
- 濃度: {{concentration}}
- 時間: {{duration}}
- 解析: {{readout}}

## 条件
{{#each conditions}}
- {{.}}
{{/each}}

## 実施内容

## 結果

## 考察

## 備考
{{notes}}
`,
  },
  {
    id: "biochem-assay",
    name: "生化学実験",
    description: "酵素活性測定、タンパク質精製、電気泳動・Westernなど、バッファー・反応条件の記録に。",
    category: "生化学",
    fields: [
      ...COMMON_FIELDS,
      {
        key: "assay_type", label: "実験種別", type: "select",
        options: ["酵素活性測定", "タンパク質精製", "SDS-PAGE / Western", "バッファー・試薬調製", "その他"]
      },
      { key: "sample_name", label: "試料・タンパク質", type: "text" },
      { key: "enzyme_lot", label: "酵素 / 抗体 Lot", type: "text" },
      { key: "substrate", label: "基質 / 抗原", type: "text" },
      { key: "buffer", label: "バッファー（組成・pH）", type: "textarea" },
      { key: "temperature", label: "温度", type: "text" },
      { key: "incubation", label: "反応・インキュベーション時間", type: "text" },
      { key: "detection", label: "検出（波長・抗体・ゲル%など）", type: "text" },
      { key: "reagents", label: "試薬（1行に1つ: 名前, 濃度, Lot）", type: "list" },
      { key: "procedure", label: "手順", type: "list" },
      { key: "notes", label: "備考", type: "textarea" },
    ],
    body: `# {{experiment_date}} {{experiment_name}}

**記録時刻:** {{experiment_time}}
**担当:** {{operator}}
**目的:** {{purpose}}
**実験種別:** {{assay_type}}
**試料・タンパク質:** {{sample_name}}

## 反応条件
- 酵素 / 抗体 Lot: {{enzyme_lot}}
- 基質 / 抗原: {{substrate}}
- バッファー: {{buffer}}
- 温度: {{temperature}}
- 反応・インキュベーション時間: {{incubation}}
- 検出: {{detection}}

## 使用試薬
{{#each reagents}}
- {{.}}
{{/each}}

## 実施内容
{{#each procedure}}
1. {{.}}
{{/each}}

## 結果

## 考察

## 備考
{{notes}}
`,
  },
  {
    id: "lcms-run",
    name: "LC-MS測定",
    description: "グラジエントとカラム情報を含む装置測定。",
    category: "プロテオミクス",
    fields: [
      ...COMMON_FIELDS,
      { key: "instrument", label: "装置", type: "text" },
      { key: "column", label: "カラム", type: "text" },
      { key: "gradient", label: "グラジエント", type: "text" },
      { key: "injection_volume", label: "注入量（µL）", type: "text" },
      { key: "sample_count", label: "サンプル数", type: "number" },
      { key: "run_order", label: "測定順", type: "list" },
      { key: "notes", label: "備考", type: "textarea" },
    ],
    body: `# {{experiment_date}} {{experiment_name}}

**記録時刻:** {{experiment_time}}
**担当:** {{operator}}
**目的:** {{purpose}}

## 測定条件
- 装置: {{instrument}}
- カラム: {{column}}
- グラジエント: {{gradient}}
- 注入量: {{injection_volume}}
- サンプル数: {{sample_count}}

## 測定順
{{#each run_order}}
1. {{.}}
{{/each}}

## 結果

## 考察

## 備考
{{notes}}
`,
  },
  {
    id: "western-blot",
    name: "ウェスタンブロット",
    description: "抗体・希釈率・転写条件まで含めたWestern blotの記録。",
    category: "生化学",
    fields: [
      ...COMMON_FIELDS,
      { key: "sample_name", label: "試料", type: "text" },
      { key: "lysis_buffer", label: "溶解バッファー（組成・阻害剤）", type: "textarea" },
      { key: "protein_amount", label: "アプライ量（µg/lane）", type: "text", defaultValue: "20" },
      { key: "gel_percent", label: "ゲル濃度", type: "select", options: ["8%", "10%", "12%", "15%", "4-20% グラジエント"], defaultValue: "10%" },
      { key: "transfer", label: "転写条件（膜・電流・時間）", type: "text" },
      { key: "blocking", label: "ブロッキング", type: "text" },
      { key: "primary_antibody", label: "一次抗体（名前, 希釈, Lot）", type: "text" },
      { key: "secondary_antibody", label: "二次抗体（名前, 希釈, Lot）", type: "text" },
      { key: "loading_control", label: "内部標準", type: "text" },
      { key: "detection", label: "検出（ECL・撮影装置・露光）", type: "text" },
      { key: "lanes", label: "レーン割当（1行に1つ）", type: "list" },
      { key: "notes", label: "備考", type: "textarea" },
    ],
    body: `# {{experiment_date}} {{experiment_name}}

**記録時刻:** {{experiment_time}}
**担当:** {{operator}}
**目的:** {{purpose}}
**試料:** {{sample_name}}

## 泳動・転写条件
- 溶解バッファー: {{lysis_buffer}}
- アプライ量: {{protein_amount}} µg/lane
- ゲル濃度: {{gel_percent}}
- 転写: {{transfer}}
- ブロッキング: {{blocking}}

## 抗体
- 一次抗体: {{primary_antibody}}
- 二次抗体: {{secondary_antibody}}
- 内部標準: {{loading_control}}
- 検出: {{detection}}

## レーン割当
{{#each lanes}}
- {{.}}
{{/each}}

## 実施内容


## 結果

## 考察

## 備考
{{notes}}

## 添付ファイル
`,
  },
  {
    id: "protein-purification",
    name: "タンパク質精製",
    description: "発現・破砕からクロマトグラフィー、収量と純度の確認まで。",
    category: "生化学",
    fields: [
      ...COMMON_FIELDS,
      { key: "target_protein", label: "標的タンパク質・コンストラクト", type: "text" },
      { key: "expression_host", label: "発現系", type: "select", options: ["E. coli BL21(DE3)", "E. coli Rosetta", "昆虫細胞 (Sf9)", "HEK293", "無細胞系", "その他"] },
      { key: "induction", label: "誘導条件", type: "text" },
      { key: "lysis", label: "破砕条件", type: "text" },
      { key: "chromatography", label: "精製法", type: "select", options: ["His タグ親和 (Ni-NTA)", "GST タグ親和", "イオン交換", "ゲルろ過 (SEC)", "疎水性相互作用", "多段階", "その他"] },
      { key: "column", label: "カラム", type: "text" },
      { key: "buffer_a", label: "バッファーA（結合）", type: "textarea" },
      { key: "buffer_b", label: "バッファーB（溶出）", type: "textarea" },
      { key: "tag_cleavage", label: "タグ切断（酵素・条件）", type: "text" },
      { key: "yield", label: "収量（mg / 培養L）", type: "text" },
      { key: "purity", label: "純度確認（SDS-PAGE・A280 など）", type: "text" },
      { key: "storage", label: "保存条件", type: "text" },
      { key: "fractions", label: "画分メモ（1行に1つ）", type: "list" },
      { key: "notes", label: "備考", type: "textarea" },
    ],
    body: `# {{experiment_date}} {{experiment_name}}

**記録時刻:** {{experiment_time}}
**担当:** {{operator}}
**目的:** {{purpose}}
**標的:** {{target_protein}}

## 発現
- 発現系: {{expression_host}}
- 誘導条件: {{induction}}
- 破砕条件: {{lysis}}

## 精製
- 方法: {{chromatography}}
- カラム: {{column}}
- バッファーA: {{buffer_a}}
- バッファーB: {{buffer_b}}
- タグ切断: {{tag_cleavage}}

## 画分
{{#each fractions}}
- {{.}}
{{/each}}

## 収量・純度
- 収量: {{yield}}
- 純度確認: {{purity}}
- 保存条件: {{storage}}

## 結果

## 考察

## 備考
{{notes}}

## 添付ファイル
`,
  },
  {
    id: "enzyme-kinetics",
    name: "酵素反応速度論",
    description: "基質濃度系列から Km・Vmax・阻害様式を求める測定。",
    category: "生化学",
    fields: [
      ...COMMON_FIELDS,
      { key: "enzyme", label: "酵素（名前・Lot）", type: "text" },
      { key: "enzyme_conc", label: "酵素濃度", type: "text" },
      { key: "substrate", label: "基質", type: "text" },
      { key: "substrate_range", label: "基質濃度系列", type: "text" },
      { key: "inhibitor", label: "阻害剤（名前・濃度）", type: "text" },
      { key: "buffer", label: "反応バッファー（組成・pH）", type: "textarea" },
      { key: "temperature", label: "反応温度", type: "text" },
      { key: "detection", label: "検出（波長・蛍光・HPLC など）", type: "text" },
      { key: "extinction", label: "モル吸光係数 / 検量線", type: "text" },
      { key: "reaction_time", label: "測定時間・サンプリング間隔", type: "text" },
      { key: "replicates", label: "反復数", type: "number", defaultValue: "3" },
      { key: "analysis", label: "解析法", type: "select", options: ["Michaelis-Menten 非線形回帰", "Lineweaver-Burk", "Eadie-Hofstee", "IC50 / Ki", "その他"] },
      { key: "conditions", label: "条件（1行に1つ）", type: "list" },
      { key: "notes", label: "備考", type: "textarea" },
    ],
    body: `# {{experiment_date}} {{experiment_name}}

**記録時刻:** {{experiment_time}}
**担当:** {{operator}}
**目的:** {{purpose}}

## 反応系
- 酵素: {{enzyme}}（{{enzyme_conc}}）
- 基質: {{substrate}}
- 基質濃度系列: {{substrate_range}}
- 阻害剤: {{inhibitor}}
- バッファー: {{buffer}}
- 温度: {{temperature}}
- 測定時間: {{reaction_time}}
- 反復数: {{replicates}}

## 検出・定量
- 検出: {{detection}}
- モル吸光係数 / 検量線: {{extinction}}
- 解析法: {{analysis}}

## 条件
{{#each conditions}}
- {{.}}
{{/each}}

## 結果

| 項目 | 値 |
|---|---|
| Km |  |
| Vmax |  |
| kcat |  |
| kcat/Km |  |

## 考察

## 備考
{{notes}}

## 添付ファイル
`,
  },
  {
    id: "protein-quantification",
    name: "タンパク質定量",
    description: "BCA / Bradford / A280 などによる濃度測定と検量線の記録。",
    category: "生化学",
    fields: [
      ...COMMON_FIELDS,
      { key: "method", label: "定量法", type: "select", options: ["BCA", "Bradford", "A280", "Lowry", "蛍光法 (Qubit など)"], defaultValue: "BCA" },
      { key: "kit_lot", label: "キット・試薬 Lot", type: "text" },
      { key: "standard", label: "標準物質", type: "text", defaultValue: "BSA" },
      { key: "standard_range", label: "検量線の濃度範囲", type: "text" },
      { key: "dilution", label: "試料希釈率", type: "text" },
      { key: "wavelength", label: "測定波長", type: "text", defaultValue: "562 nm" },
      { key: "instrument", label: "測定機器", type: "text" },
      { key: "incubation", label: "発色条件", type: "text" },
      { key: "replicates", label: "反復数", type: "number", defaultValue: "3" },
      { key: "sample_count", label: "サンプル数", type: "number" },
      { key: "samples", label: "試料一覧（1行に1つ: 名前, 希釈, 実測値）", type: "list" },
      { key: "notes", label: "備考", type: "textarea" },
    ],
    body: `# {{experiment_date}} {{experiment_name}}

**記録時刻:** {{experiment_time}}
**担当:** {{operator}}
**目的:** {{purpose}}
**サンプル数:** {{sample_count}}

## 測定条件
- 定量法: {{method}}
- キット・試薬 Lot: {{kit_lot}}
- 標準物質: {{standard}}
- 検量線範囲: {{standard_range}}
- 試料希釈率: {{dilution}}
- 測定波長: {{wavelength}}
- 測定機器: {{instrument}}
- 発色条件: {{incubation}}
- 反復数: {{replicates}}

## 試料一覧
{{#each samples}}
- {{.}}
{{/each}}

## 検量線
- 回帰式:
- R2:

## 結果

## 考察

## 備考
{{notes}}

## 添付ファイル
`,
  },
  {
    id: "elisa",
    name: "ELISA",
    description: "プレート配置・標準曲線・抗体条件を含む定量イムノアッセイ。",
    category: "生化学",
    fields: [
      ...COMMON_FIELDS,
      { key: "assay_format", label: "測定形式", type: "select", options: ["サンドイッチ", "直接", "間接", "競合"] },
      { key: "target", label: "標的抗原", type: "text" },
      { key: "kit", label: "キット（メーカー・品番・Lot）", type: "text" },
      { key: "sample_type", label: "試料の種類", type: "text" },
      { key: "dilution", label: "試料希釈率", type: "text" },
      { key: "standard_range", label: "標準曲線の範囲・点数", type: "text" },
      { key: "coating", label: "固相化条件", type: "text" },
      { key: "blocking", label: "ブロッキング", type: "text" },
      { key: "detection_antibody", label: "検出抗体（希釈・Lot）", type: "text" },
      { key: "substrate", label: "基質・発色", type: "text" },
      { key: "wavelength", label: "測定波長", type: "text" },
      { key: "incubation", label: "インキュベーション条件", type: "text" },
      { key: "replicates", label: "反復数", type: "number", defaultValue: "2" },
      { key: "layout", label: "プレート配置（1行に1つ）", type: "list" },
      { key: "notes", label: "備考", type: "textarea" },
    ],
    body: `# {{experiment_date}} {{experiment_name}}

**記録時刻:** {{experiment_time}}
**担当:** {{operator}}
**目的:** {{purpose}}
**標的抗原:** {{target}}

## 測定条件
- 形式: {{assay_format}}
- キット: {{kit}}
- 試料: {{sample_type}}（希釈 {{dilution}}）
- 標準曲線: {{standard_range}}
- 固相化: {{coating}}
- ブロッキング: {{blocking}}
- 検出抗体: {{detection_antibody}}
- 基質・発色: {{substrate}}
- 測定波長: {{wavelength}}
- インキュベーション: {{incubation}}
- 反復数: {{replicates}}

## プレート配置
{{#each layout}}
- {{.}}
{{/each}}

## 検量線
- 回帰モデル（4PL など）:
- R2:

## 結果

## 考察

## 備考
{{notes}}

## 添付ファイル
`,
  },
  {
    id: "rna-extraction",
    name: "RNA抽出・cDNA合成",
    description: "抽出キット、純度チェック、逆転写までの一連の記録。",
    category: "分子生物学",
    fields: [
      ...COMMON_FIELDS,
      { key: "source", label: "試料（細胞・組織）", type: "text" },
      { key: "sample_count", label: "サンプル数", type: "number" },
      { key: "extraction_kit", label: "抽出キット・試薬（Lot）", type: "text" },
      { key: "dnase", label: "DNase処理", type: "select", options: ["カラム上で実施", "溶液中で実施", "未実施"] },
      { key: "elution_volume", label: "溶出量（µL）", type: "text" },
      { key: "quantification", label: "濃度測定法", type: "text" },
      { key: "purity", label: "純度（A260/280・A260/230・RIN）", type: "text" },
      { key: "rt_kit", label: "逆転写キット（Lot）", type: "text" },
      { key: "rt_input", label: "逆転写の鋳型量", type: "text", defaultValue: "500 ng" },
      { key: "rt_primer", label: "逆転写プライマー", type: "select", options: ["Oligo(dT)", "ランダムプライマー", "両方", "遺伝子特異的"] },
      { key: "rt_program", label: "逆転写プログラム", type: "text" },
      { key: "storage", label: "保存条件", type: "text" },
      { key: "samples", label: "試料一覧（1行に1つ: 名前, 濃度, A260/280）", type: "list" },
      { key: "notes", label: "備考", type: "textarea" },
    ],
    body: `# {{experiment_date}} {{experiment_name}}

**記録時刻:** {{experiment_time}}
**担当:** {{operator}}
**目的:** {{purpose}}
**試料:** {{source}}
**サンプル数:** {{sample_count}}

## RNA抽出
- 抽出キット・試薬: {{extraction_kit}}
- DNase処理: {{dnase}}
- 溶出量: {{elution_volume}}
- 濃度測定: {{quantification}}
- 純度: {{purity}}

## cDNA合成
- キット: {{rt_kit}}
- 鋳型量: {{rt_input}}
- プライマー: {{rt_primer}}
- プログラム: {{rt_program}}
- 保存条件: {{storage}}

## 試料一覧
{{#each samples}}
- {{.}}
{{/each}}

## 結果

## 考察

## 備考
{{notes}}

## 添付ファイル
`,
  },
  {
    id: "rt-qpcr",
    name: "RT-qPCR",
    description: "標的遺伝子・内部標準・サイクル条件を含む定量PCR。",
    category: "分子生物学",
    fields: [
      ...COMMON_FIELDS,
      { key: "instrument", label: "装置", type: "text" },
      { key: "chemistry", label: "検出化学", type: "select", options: ["SYBR Green", "TaqMan プローブ"] },
      { key: "master_mix", label: "マスターミックス（Lot）", type: "text" },
      { key: "reference_gene", label: "内部標準遺伝子", type: "text" },
      { key: "template_amount", label: "cDNA投入量", type: "text" },
      { key: "primer_conc", label: "プライマー濃度", type: "text", defaultValue: "500 nM" },
      { key: "reaction_volume", label: "反応液量（µL）", type: "text", defaultValue: "10" },
      { key: "cycling", label: "サイクル条件", type: "text" },
      { key: "melt_curve", label: "融解曲線解析", type: "select", options: ["実施", "未実施"] },
      { key: "replicates", label: "テクニカル反復数", type: "number", defaultValue: "3" },
      { key: "analysis_method", label: "解析法", type: "select", options: ["ΔΔCt 法", "検量線法（絶対定量）", "ΔCt 法"] },
      { key: "controls", label: "対照（NTC・-RT など）", type: "text" },
      { key: "target_genes", label: "標的遺伝子（1行に1つ: 遺伝子, プライマー配列/品番）", type: "list" },
      { key: "notes", label: "備考", type: "textarea" },
    ],
    body: `# {{experiment_date}} {{experiment_name}}

**記録時刻:** {{experiment_time}}
**担当:** {{operator}}
**目的:** {{purpose}}

## 測定条件
- 装置: {{instrument}}
- 検出化学: {{chemistry}}
- マスターミックス: {{master_mix}}
- cDNA投入量: {{template_amount}}
- プライマー濃度: {{primer_conc}}
- 反応液量: {{reaction_volume}} µL
- サイクル条件: {{cycling}}
- 融解曲線解析: {{melt_curve}}
- テクニカル反復: {{replicates}}
- 対照: {{controls}}

## 標的遺伝子
{{#each target_genes}}
- {{.}}
{{/each}}

- 内部標準: {{reference_gene}}

## 解析
- 解析法: {{analysis_method}}
- 増幅効率:

## 結果

## 考察

## 備考
{{notes}}

## 添付ファイル
`,
  },
  {
    id: "pcr-cloning",
    name: "PCR・クローニング",
    description: "増幅条件からベクター構築、形質転換、配列確認まで。",
    category: "分子生物学",
    fields: [
      ...COMMON_FIELDS,
      { key: "template_dna", label: "鋳型DNA", type: "text" },
      { key: "forward_primer", label: "Forward プライマー", type: "text" },
      { key: "reverse_primer", label: "Reverse プライマー", type: "text" },
      { key: "polymerase", label: "ポリメラーゼ（Lot）", type: "text" },
      { key: "annealing_temp", label: "アニーリング温度", type: "text" },
      { key: "extension_time", label: "伸長時間", type: "text" },
      { key: "cycles", label: "サイクル数", type: "number", defaultValue: "30" },
      { key: "product_size", label: "予想産物長（bp）", type: "text" },
      { key: "cloning_method", label: "クローニング法", type: "select", options: ["制限酵素 + ライゲーション", "Gibson Assembly", "In-Fusion", "TOPO", "Golden Gate", "サブクローニングなし"] },
      { key: "vector", label: "ベクター", type: "text" },
      { key: "restriction_enzymes", label: "制限酵素", type: "text" },
      { key: "host_strain", label: "形質転換株", type: "text" },
      { key: "selection", label: "選択マーカー・培地", type: "text" },
      { key: "colony_count", label: "コロニー数（本命 / 対照）", type: "text" },
      { key: "verification", label: "確認方法", type: "text" },
      { key: "procedure", label: "手順", type: "list" },
      { key: "notes", label: "備考", type: "textarea" },
    ],
    body: `# {{experiment_date}} {{experiment_name}}

**記録時刻:** {{experiment_time}}
**担当:** {{operator}}
**目的:** {{purpose}}

## PCR条件
- 鋳型DNA: {{template_dna}}
- Forward: {{forward_primer}}
- Reverse: {{reverse_primer}}
- ポリメラーゼ: {{polymerase}}
- アニーリング温度: {{annealing_temp}}
- 伸長時間: {{extension_time}}
- サイクル数: {{cycles}}
- 予想産物長: {{product_size}} bp

## クローニング
- 方法: {{cloning_method}}
- ベクター: {{vector}}
- 制限酵素: {{restriction_enzymes}}
- 形質転換株: {{host_strain}}
- 選択: {{selection}}
- コロニー数: {{colony_count}}
- 確認方法: {{verification}}

## 実施内容
{{#each procedure}}
1. {{.}}
{{/each}}

## 結果

## 考察

## 備考
{{notes}}

## 添付ファイル
`,
  },
  {
    id: "cell-culture",
    name: "細胞培養・継代",
    description: "継代数、培地組成、播種密度などの日常的な培養記録。",
    category: "細胞生物学",
    fields: [
      ...COMMON_FIELDS,
      { key: "cell_line", label: "細胞株・初代細胞", type: "text" },
      { key: "passage_from", label: "継代前の継代数", type: "text" },
      { key: "passage_to", label: "継代後の継代数", type: "text" },
      { key: "medium", label: "基礎培地", type: "text" },
      { key: "serum", label: "血清（種類・濃度・Lot）", type: "text" },
      { key: "supplements", label: "添加因子（抗生物質・増殖因子など）", type: "text" },
      { key: "dissociation", label: "剥離処理", type: "text" },
      { key: "confluence", label: "継代時のコンフルエンシー", type: "text" },
      { key: "split_ratio", label: "継代比", type: "text" },
      { key: "seeding_density", label: "播種密度", type: "text" },
      { key: "vessel", label: "培養容器", type: "select", options: ["10 cm dish", "6 cm dish", "T25 フラスコ", "T75 フラスコ", "6 well", "12 well", "24 well", "96 well", "その他"] },
      { key: "incubator", label: "培養条件", type: "text" },
      { key: "viability", label: "生存率・細胞数", type: "text" },
      { key: "mycoplasma", label: "マイコプラズマ検査", type: "select", options: ["陰性（直近検査）", "未実施", "要確認"] },
      { key: "notes", label: "備考", type: "textarea" },
    ],
    body: `# {{experiment_date}} {{experiment_name}}

**記録時刻:** {{experiment_time}}
**担当:** {{operator}}
**目的:** {{purpose}}

## 細胞
- 細胞: {{cell_line}}
- 継代: P{{passage_from}} → P{{passage_to}}
- 生存率・細胞数: {{viability}}
- マイコプラズマ: {{mycoplasma}}

## 培地
- 基礎培地: {{medium}}
- 血清: {{serum}}
- 添加因子: {{supplements}}

## 継代条件
- 剥離処理: {{dissociation}}
- コンフルエンシー: {{confluence}}
- 継代比: {{split_ratio}}
- 播種密度: {{seeding_density}}
- 培養容器: {{vessel}}
- 培養条件: {{incubator}}

## 観察

## 備考
{{notes}}

## 添付ファイル
`,
  },
  {
    id: "transfection",
    name: "遺伝子導入・ノックダウン",
    description: "プラスミド・siRNA・CRISPR の導入条件と回収タイミング。",
    category: "細胞生物学",
    fields: [
      ...COMMON_FIELDS,
      { key: "cell_type", label: "細胞", type: "text" },
      { key: "vessel", label: "培養容器", type: "select", options: ["6 well", "12 well", "24 well", "96 well", "10 cm dish", "その他"] },
      { key: "seeding_density", label: "播種密度・播種日", type: "text" },
      { key: "nucleic_acid", label: "導入核酸", type: "select", options: ["プラスミドDNA", "siRNA", "shRNA（ウイルス）", "mRNA", "CRISPR RNP"] },
      { key: "construct", label: "コンストラクト・標的配列", type: "text" },
      { key: "amount", label: "導入量（well あたり）", type: "text" },
      { key: "reagent", label: "導入試薬（Lot）", type: "text" },
      { key: "ratio", label: "核酸:試薬 比", type: "text" },
      { key: "medium_change", label: "培地交換のタイミング", type: "text" },
      { key: "selection", label: "選択・濃縮", type: "text" },
      { key: "harvest_time", label: "回収タイミング", type: "text" },
      { key: "readout", label: "評価方法", type: "text" },
      { key: "efficiency", label: "導入効率・ノックダウン効率", type: "text" },
      { key: "conditions", label: "条件（1行に1つ: 対照を含む）", type: "list" },
      { key: "notes", label: "備考", type: "textarea" },
    ],
    body: `# {{experiment_date}} {{experiment_name}}

**記録時刻:** {{experiment_time}}
**担当:** {{operator}}
**目的:** {{purpose}}

## 細胞・播種
- 細胞: {{cell_type}}
- 培養容器: {{vessel}}
- 播種密度・播種日: {{seeding_density}}

## 導入条件
- 導入核酸: {{nucleic_acid}}
- コンストラクト・標的配列: {{construct}}
- 導入量: {{amount}}
- 導入試薬: {{reagent}}
- 核酸:試薬 比: {{ratio}}
- 培地交換: {{medium_change}}
- 選択・濃縮: {{selection}}
- 回収タイミング: {{harvest_time}}
- 評価方法: {{readout}}

## 条件
{{#each conditions}}
- {{.}}
{{/each}}

## 結果
- 導入効率・ノックダウン効率: {{efficiency}}

## 考察

## 備考
{{notes}}

## 添付ファイル
`,
  },
  {
    id: "immunostaining",
    name: "免疫染色・蛍光顕微鏡",
    description: "固定・透過処理から抗体条件、撮影設定までの染色記録。",
    category: "細胞生物学",
    fields: [
      ...COMMON_FIELDS,
      { key: "specimen", label: "標本（細胞・組織切片）", type: "text" },
      { key: "fixation", label: "固定条件", type: "text" },
      { key: "permeabilization", label: "透過処理", type: "text" },
      { key: "antigen_retrieval", label: "抗原賦活化", type: "text" },
      { key: "blocking", label: "ブロッキング", type: "text" },
      { key: "primary_antibody", label: "一次抗体（名前, 希釈, Lot）", type: "text" },
      { key: "secondary_antibody", label: "二次抗体（蛍光色素, 希釈, Lot）", type: "text" },
      { key: "counterstain", label: "対比染色", type: "text" },
      { key: "mounting", label: "封入剤", type: "text" },
      { key: "microscope", label: "顕微鏡・対物レンズ", type: "text" },
      { key: "channels", label: "取得チャネル・露光条件", type: "text" },
      { key: "controls", label: "対照（一次抗体なし など）", type: "text" },
      { key: "quantification", label: "定量方法", type: "text" },
      { key: "conditions", label: "条件（1行に1つ）", type: "list" },
      { key: "notes", label: "備考", type: "textarea" },
    ],
    body: `# {{experiment_date}} {{experiment_name}}

**記録時刻:** {{experiment_time}}
**担当:** {{operator}}
**目的:** {{purpose}}
**標本:** {{specimen}}

## 前処理
- 固定: {{fixation}}
- 透過処理: {{permeabilization}}
- 抗原賦活化: {{antigen_retrieval}}
- ブロッキング: {{blocking}}

## 抗体・染色
- 一次抗体: {{primary_antibody}}
- 二次抗体: {{secondary_antibody}}
- 対比染色: {{counterstain}}
- 封入剤: {{mounting}}
- 対照: {{controls}}

## 撮影
- 顕微鏡・対物レンズ: {{microscope}}
- チャネル・露光条件: {{channels}}
- 定量方法: {{quantification}}

## 条件
{{#each conditions}}
- {{.}}
{{/each}}

## 結果

## 考察

## 備考
{{notes}}

## 添付ファイル
`,
  },
  {
    id: "flow-cytometry",
    name: "フローサイトメトリー",
    description: "抗体パネル、コンペンセーション、ゲーティングの記録。",
    category: "細胞生物学",
    fields: [
      ...COMMON_FIELDS,
      { key: "cell_type", label: "細胞・試料", type: "text" },
      { key: "sample_count", label: "サンプル数", type: "number" },
      { key: "instrument", label: "装置・構成", type: "text" },
      { key: "staining_type", label: "染色の種類", type: "select", options: ["表面抗原", "細胞内抗原", "生死判定", "細胞周期", "アポトーシス", "蛍光タンパク質"] },
      { key: "cell_number", label: "染色に用いた細胞数", type: "text" },
      { key: "fc_block", label: "Fcブロック", type: "text" },
      { key: "viability_dye", label: "生死判定色素", type: "text" },
      { key: "fixation", label: "固定・透過処理", type: "text" },
      { key: "compensation", label: "コンペンセーション", type: "text" },
      { key: "controls", label: "対照（FMO・アイソタイプ・無染色）", type: "text" },
      { key: "events", label: "取得イベント数", type: "text" },
      { key: "gating", label: "ゲーティング戦略", type: "textarea" },
      { key: "analysis_software", label: "解析ソフト", type: "text" },
      { key: "panel", label: "抗体パネル（1行に1つ: 抗原, 蛍光色素, 希釈, Lot）", type: "list" },
      { key: "notes", label: "備考", type: "textarea" },
    ],
    body: `# {{experiment_date}} {{experiment_name}}

**記録時刻:** {{experiment_time}}
**担当:** {{operator}}
**目的:** {{purpose}}
**試料:** {{cell_type}}
**サンプル数:** {{sample_count}}

## 染色条件
- 染色の種類: {{staining_type}}
- 細胞数: {{cell_number}}
- Fcブロック: {{fc_block}}
- 生死判定色素: {{viability_dye}}
- 固定・透過処理: {{fixation}}

## 抗体パネル
{{#each panel}}
- {{.}}
{{/each}}

## 測定
- 装置: {{instrument}}
- コンペンセーション: {{compensation}}
- 対照: {{controls}}
- 取得イベント数: {{events}}

## 解析
- ゲーティング戦略: {{gating}}
- 解析ソフト: {{analysis_software}}

## 結果

## 考察

## 備考
{{notes}}

## 添付ファイル
`,
  },
];

/**
 * Renders a template body.
 *
 * Supports {{key}} substitution and {{#each key}} ... {{/each}} blocks where
 * {{.}} is the current item. Missing values render as an em dash so the gap is
 * visible in the notebook rather than silently blank.
 */
export function renderTemplate(
  template: NotebookTemplate,
  values: TemplateValues,
): string {
  const resolved: TemplateValues = {};
  for (const f of template.fields) {
    const v = values[f.key];
    const empty =
      v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
    resolved[f.key] = empty ? (f.defaultValue ?? "") : v;
  }
  for (const [k, v] of Object.entries(values)) {
    if (!(k in resolved)) resolved[k] = v;
  }

  let out = template.body;

  // Each-blocks first, so item placeholders are not eaten by scalar
  // substitution.
  out = out.replace(
    /\{\{#each\s+(\w+)\}\}\r?\n?([\s\S]*?)\{\{\/each\}\}\r?\n?/g,
    (_whole, key: string, inner: string) => {
      const raw = resolved[key];
      const items = Array.isArray(raw)
        ? raw
        : typeof raw === "string" && raw.trim() !== ""
          ? raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
          : [];
      if (items.length === 0) return "_(未記入)_\n";
      return items
        .map((item) => inner.replace(/\{\{\.\}\}/g, String(item)))
        .join("");
    },
  );

  out = out.replace(/\{\{(\w+)\}\}/g, (_whole, key: string) => {
    const v = resolved[key];
    if (v === undefined || v === null || v === "") return "—";
    if (Array.isArray(v)) return v.join(", ");
    return String(v);
  });

  out = injectFilledSection(out, "## 結果", resolved.results);
  out = injectFilledSection(out, "## 考察", resolved.discussion);
  out = injectFilledSection(out, "## 明日の予定", resolved.tomorrow_plan);

  const time = resolved.experiment_time;
  if (time && String(time).trim() && !out.includes("記録時刻")) {
    out = out.replace(/^(# .+\n\n)/m, `$1**記録時刻:** ${String(time).trim()}\n\n`);
  }

  return out.trimEnd() + "\n";
}

/** Writes section body when the template left a heading empty. */
function injectFilledSection(body: string, heading: string, raw: unknown): string {
  const content = raw === undefined || raw === null ? "" : String(raw).trim();
  if (!content) return body;
  const esc = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const emptySection = new RegExp(`(${esc}\\s*\\n)(?:\\s*\\n)*(?=## |$)`, "m");
  if (emptySection.test(body)) {
    return body.replace(emptySection, `$1\n${content}\n\n`);
  }
  if (!body.includes(heading)) {
    return `${body.trimEnd()}\n\n${heading}\n\n${content}\n`;
  }
  return body;
}

/** Checks required fields before a notebook entry is saved. */
export function validateTemplateValues(
  template: NotebookTemplate,
  values: TemplateValues,
): { valid: boolean; missing: string[] } {
  const missing: string[] = [];
  for (const f of template.fields) {
    if (!f.required) continue;
    const v = values[f.key];
    const empty =
      v === undefined || v === null || String(v).trim() === "" ||
      (Array.isArray(v) && v.length === 0);
    if (empty && !f.defaultValue) missing.push(f.label);
  }
  return { valid: missing.length === 0, missing };
}

export function getTemplate(id: string): NotebookTemplate | undefined {
  return BUILT_IN_TEMPLATES.find((t) => t.id === id);
}
