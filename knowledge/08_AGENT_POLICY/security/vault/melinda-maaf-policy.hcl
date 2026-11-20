# Example KV v2 policy for the MAAF token broker only.
path "secret/data/melinda/prod/social/*" {
  capabilities = ["read"]
}
path "secret/data/melinda/prod/email/*" {
  capabilities = ["read"]
}
path "secret/data/melinda/prod/website/*" {
  capabilities = ["read"]
}
path "secret/metadata/melinda/prod/*" {
  capabilities = ["read", "list"]
}
