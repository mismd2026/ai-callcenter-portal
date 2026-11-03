output "url" {
  description = "ポータルの URL"
  value       = google_cloud_run_v2_service.portal.uri
}

output "image_repository" {
  description = "コンテナイメージの置き場（gcloud builds submit --tag に使う）"
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.portal.repository_id}"
}

output "db_private_ip" {
  description = "Cloud SQL の内部 IP（VPC の中からだけ届く）"
  value       = google_sql_database_instance.portal.private_ip_address
}
