export interface CompoundReference {
  cid: number; name: string; formula: string; mass: number | null; url: string;
}
export interface CompoundDetail extends CompoundReference {
  cas: string | null;
  hazards: { title: string; url: string; excerpt: string; kind: string; source: string }[];
  properties: { label: string; value: string; url: string }[];
  pictograms: { name: string; code: string }[];
  sourceGaps: string[];
  discreteModel: boolean;
}
export interface MolecularModel {
  atoms: { element: string; x: number; y: number; z: number }[];
  bonds: { from: number; to: number; order: number }[];
  dimensions: "2d" | "3d";
  source: string;
}
export interface PairEvidence {
  id: string; finding: "incompatible" | "conditional" | "insufficient";
  statement: string; conditions: string; title: string; url: string; verifiedAt: string;
}
