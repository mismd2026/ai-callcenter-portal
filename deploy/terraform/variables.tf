variable "project_id" {
  description = "GCP（Firebase）のプロジェクト ID"
  type        = string
}

variable "region" {
  description = "リージョン"
  type        = string
  default     = "asia-northeast1"
}

variable "name" {
  description = "リソース名の接頭辞"
  type        = string
  default     = "portal"
}

variable "network_name" {
  description = "接続する VPC。ai-callcenter-ollama の Terraform が作るネットワークを既定にしている"
  type        = string
  default     = "callcenter-vpc"
}

variable "subnet_name" {
  description = "Cloud Run の通信を流すサブネット"
  type        = string
  default     = "callcenter-subnet"
}

variable "image" {
  description = "Cloud Run で動かすコンテナイメージ（README の手順でビルドしたもの）"
  type        = string
}

variable "firebase_api_key" {
  description = "Firebase の Web API キー（画面に渡す公開値。秘密情報ではない）"
  type        = string
}

variable "db_tier" {
  description = "Cloud SQL のマシンタイプ（デモ用に最小構成）"
  type        = string
  default     = "db-f1-micro"
}

variable "seed_demo_data" {
  description = "起動時にデモデータを投入する（DB が空のときだけ）"
  type        = bool
  default     = true
}
