# 顧客ポータルの公開部分。
#
#   インターネット ─▶ Cloud Run（画面＋API、Firebase のログイン必須）
#                        │ Direct VPC egress（内部 IP 宛ての通信だけ VPC に流す）
#                        ▼
#                   Cloud SQL for PostgreSQL（内部 IP のみ・外部 IP なし）
#
# AI コールセンター本体（VM）と同じ VPC に入るので、将来は本体が通話記録をこの DB に
# 書き込み、ポータルが読む構成にできる。本体はこれまでどおりインターネットに公開しない。

resource "google_project_service" "apis" {
  for_each = toset([
    "run.googleapis.com",
    "sqladmin.googleapis.com",
    "servicenetworking.googleapis.com",
    "secretmanager.googleapis.com",
    "artifactregistry.googleapis.com",
    "cloudbuild.googleapis.com",
    "identitytoolkit.googleapis.com",
  ])

  service            = each.value
  disable_on_destroy = false
}

data "google_compute_network" "vpc" {
  name = var.network_name
}

data "google_compute_subnetwork" "subnet" {
  name   = var.subnet_name
  region = var.region
}

# ---- コンテナイメージの置き場 ----

resource "google_artifact_registry_repository" "portal" {
  repository_id = var.name
  location      = var.region
  format        = "DOCKER"

  depends_on = [google_project_service.apis]
}

# ---- Cloud SQL（内部 IP のみ） ----

# Cloud SQL を VPC の内部 IP で使うための「プライベート サービス アクセス」
resource "google_compute_global_address" "private_services" {
  name          = "${var.name}-private-services"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 20
  network       = data.google_compute_network.vpc.id
}

resource "google_service_networking_connection" "private_services" {
  network                 = data.google_compute_network.vpc.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_services.name]

  depends_on = [google_project_service.apis]
}

resource "google_sql_database_instance" "portal" {
  name             = "${var.name}-db"
  database_version = "POSTGRES_16"
  region           = var.region

  # デモ用。本番では true にして誤削除を防ぐ
  deletion_protection = false

  settings {
    edition           = "ENTERPRISE"
    tier              = var.db_tier
    availability_type = "ZONAL"
    disk_size         = 10

    ip_configuration {
      ipv4_enabled    = false # 外部 IP を付けない
      private_network = data.google_compute_network.vpc.id
      ssl_mode        = "ENCRYPTED_ONLY"
    }

    backup_configuration {
      enabled = true
    }

    database_flags {
      name  = "log_min_duration_statement"
      value = "1000"
    }
  }

  depends_on = [google_service_networking_connection.private_services]
}

resource "google_sql_database" "portal" {
  name     = "portal"
  instance = google_sql_database_instance.portal.name
}

resource "random_password" "db" {
  length  = 32
  special = false
}

resource "google_sql_user" "portal" {
  name     = "portal"
  instance = google_sql_database_instance.portal.name
  password = random_password.db.result
}

# DB のパスワードは Secret Manager に置き、Cloud Run には環境変数として注入する
resource "google_secret_manager_secret" "db_password" {
  secret_id = "${var.name}-db-password"
  replication {
    auto {}
  }
  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "db_password" {
  secret      = google_secret_manager_secret.db_password.id
  secret_data = random_password.db.result
}

# ---- Cloud Run 用のサービスアカウント（最小権限） ----

resource "google_service_account" "portal" {
  account_id   = "${var.name}-run"
  display_name = "Customer portal (Cloud Run)"
}

resource "google_secret_manager_secret_iam_member" "db_password" {
  secret_id = google_secret_manager_secret.db_password.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.portal.email}"
}

# ID トークンの失効確認（check_revoked）のために、Firebase Auth の参照権限だけを付ける
resource "google_project_iam_member" "firebase_auth_viewer" {
  project = var.project_id
  role    = "roles/firebaseauth.viewer"
  member  = "serviceAccount:${google_service_account.portal.email}"
}

# ---- Cloud Run ----

resource "google_cloud_run_v2_service" "portal" {
  name                = var.name
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = false

  template {
    service_account = google_service_account.portal.email

    scaling {
      min_instance_count = 0
      max_instance_count = 3
    }

    vpc_access {
      network_interfaces {
        network    = data.google_compute_network.vpc.id
        subnetwork = data.google_compute_subnetwork.subnet.id
      }
      egress = "PRIVATE_RANGES_ONLY"
    }

    containers {
      image = var.image

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }

      env {
        name  = "AUTH_MODE"
        value = "firebase"
      }
      env {
        name  = "FIREBASE_PROJECT_ID"
        value = var.project_id
      }
      env {
        name  = "FIREBASE_AUTH_DOMAIN"
        value = "${var.project_id}.firebaseapp.com"
      }
      env {
        name  = "FIREBASE_API_KEY"
        value = var.firebase_api_key
      }
      env {
        name  = "DB_HOST"
        value = google_sql_database_instance.portal.private_ip_address
      }
      env {
        name  = "DB_USER"
        value = google_sql_user.portal.name
      }
      env {
        name  = "DB_NAME"
        value = google_sql_database.portal.name
      }
      env {
        name = "DB_PASSWORD"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.db_password.secret_id
            version = "latest"
          }
        }
      }
      env {
        name  = "SEED_DEMO_DATA"
        value = tostring(var.seed_demo_data)
      }

      startup_probe {
        http_get {
          path = "/healthz"
        }
        initial_delay_seconds = 2
        period_seconds        = 5
        failure_threshold     = 12
      }
    }
  }

  depends_on = [
    google_secret_manager_secret_iam_member.db_password,
    google_secret_manager_secret_version.db_password,
  ]
}

# 誰でもアクセスできるようにする（画面と API の利用には Firebase のログインが必要）
resource "google_cloud_run_v2_service_iam_member" "public" {
  name     = google_cloud_run_v2_service.portal.name
  location = google_cloud_run_v2_service.portal.location
  role     = "roles/run.invoker"
  member   = "allUsers"
}
