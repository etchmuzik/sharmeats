#!/usr/bin/env bash

# Shared path-boundary helpers for production backup/retention scripts.
# This file is sourced; it intentionally does not change shell options.

backup_real_dir() {
  local dir="$1"
  [[ -d "${dir}" ]] || return 1
  (cd -P -- "${dir}" 2>/dev/null && pwd)
}

backup_resolve_target() {
  local target="$1"
  local parent base parent_real
  parent="$(dirname -- "${target}")"
  base="$(basename -- "${target}")"
  parent_real="$(backup_real_dir "${parent}")" || return 1
  printf '%s/%s\n' "${parent_real%/}" "${base}"
}

validate_backup_root() {
  local target="$1"
  local repo_root="$2"
  local user_home="$3"
  local resolved repo_real home_real

  [[ -n "${target}" && "${target}" == /* ]] || {
    echo "ERROR: backup root must be a non-empty absolute path: ${target:-<empty>}" >&2
    return 1
  }
  [[ "${target}" != "/" && ! -L "${target}" ]] || {
    echo "ERROR: unsafe backup root: ${target}" >&2
    return 1
  }

  resolved="$(backup_resolve_target "${target}")" || {
    echo "ERROR: backup root parent does not exist or cannot be resolved: ${target}" >&2
    return 1
  }
  repo_real="$(backup_real_dir "${repo_root}")" || return 1
  home_real="$(backup_real_dir "${user_home}")" || return 1

  case "${resolved}" in
    "/"|"${repo_real}"|"${home_real}")
      echo "ERROR: refusing broad backup root: ${resolved}" >&2
      return 1
      ;;
  esac

  # Existing roots must resolve to the same non-symlink target. The resolved
  # parent keeps every later boundary comparison on one canonical path.
  if [[ -e "${target}" ]]; then
    [[ -d "${target}" ]] || {
      echo "ERROR: backup root exists but is not a directory: ${target}" >&2
      return 1
    }
    [[ "$(backup_real_dir "${target}")" == "${resolved}" ]] || {
      echo "ERROR: backup root resolves outside its declared path: ${target}" >&2
      return 1
    }
  fi
}

backup_dir_matches_kind() {
  local name="$1"
  local kind="$2"
  case "${kind}" in
    database-success) [[ "${name}" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] ;;
    database-failed) [[ "${name}" =~ ^[0-9]{8}T[0-9]{6}Z-FAILED$ ]] ;;
    storage-success) [[ "${name}" =~ ^storage-[0-9]{8}T[0-9]{6}Z$ ]] ;;
    storage-failed) [[ "${name}" =~ ^storage-[0-9]{8}T[0-9]{6}Z-FAILED$ ]] ;;
    *) return 1 ;;
  esac
}

list_backup_dirs() {
  local root="$1"
  local kind="$2"
  local candidate name
  for candidate in "${root}"/*; do
    [[ -d "${candidate}" && ! -L "${candidate}" ]] || continue
    name="$(basename -- "${candidate}")"
    backup_dir_matches_kind "${name}" "${kind}" || continue
    printf '%s\n' "${candidate}"
  done
}

safe_remove_backup_dir() {
  local root="$1"
  local candidate="$2"
  local kind="$3"
  local root_real parent_real name

  [[ -n "${root}" && -n "${candidate}" && -d "${candidate}" && ! -L "${candidate}" ]] || return 1
  root_real="$(backup_real_dir "${root}")" || return 1
  parent_real="$(backup_real_dir "$(dirname -- "${candidate}")")" || return 1
  [[ "${parent_real}" == "${root_real}" ]] || return 1
  name="$(basename -- "${candidate}")"
  backup_dir_matches_kind "${name}" "${kind}" || return 1
  rm -rf -- "${candidate}"
}
