// Inventory of 172 indexed credentialing files (RSIA Melinda DHAI SSOT); clinical, legal, signature and
// implementation verification pending. Server-side only: the page passes the data to the client view as props.
import index from "@/data/kredensial/index.json";

export interface KredensialDocument {
  id: string;
  filename: string;
  rel_path: string;
  url: string;
  cat_id: string;
  cat_name: string;
  subfolder: string;
  subfolder_label: string;
  title: string;
  doc_num: string;
  pic: string;
  badge: string;
  ext: string;
  size_kb: number;
}

export interface KredensialCategory {
  id: string;
  name: string;
  badge: string;
  count: number;
}

export const KREDENSIAL_CATEGORIES: KredensialCategory[] = index.categories;
export const KREDENSIAL_DOCUMENTS: KredensialDocument[] = index.documents;
