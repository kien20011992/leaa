#! /bin/bash

unset PLATFORM YARN_BUILD

cd "$(dirname "$0")" || exit

__DEPLOY__="./_deploy"


usage() {
  # shellcheck disable=SC2028
  echo "\n\n\n\n🔰  Usage: $0 -p local_start|docker_start|docker_install|vercel [-i]  (e.g. sh -p test)\n\n\n\n"
  exit 2
}

set_var() {
  local arg_name=$1
  shift

  # shellcheck disable=SC2028
  echo "VAR { $arg_name: $* }"

  if [ -z "${!arg_name}" ]; then
    if [ "$arg_name" = "PLATFORM" ]; then
      if echo "$*" | grep -Eq '^local_start|docker_start|docker_install|vercel'; then
        eval "$arg_name=\"$*\""
      else
        usage
      fi
    fi

    if [ "$arg_name" = "YARN_BUILD" ]; then
        eval "$arg_name=\"$*\""
    fi

    if [ "$arg_name" = "YARN_BUILD" ]; then
        eval "$arg_name=\"$*\""
    fi

  else
    echo "Error: $arg_name already set"
    usage
  fi
}


platform_docker_install() {
  if [ -f "${__DEPLOY__}/.env" ]; then
      # shellcheck disable=SC2028
      echo '\n✨  Already .env, Do not Copy :)\n'
    else
      cp -f ./.env ${__DEPLOY__}
  fi

  if [ -f "./ecosystem.config.js" ]; then
      cp -f ./ecosystem.config.js ${__DEPLOY__}
    else
      echo '⚠️  Please rename ecosystem.config.js.example to ecosystem.config.js first \n'
  fi

  cp -f ./docker-compose.yml ${__DEPLOY__}

  cd ${__DEPLOY__} || exit

  # shellcheck disable=SC2002
  cat ./docker-compose.yml | \
  sed 's/${__ENV__}_${DOCKER_NODE_CONTAINER_NAME}/deploy_yarn_install/g' | \
  sed 's/yarn docker-start/yarn docker-install/g' > docker-compose-deploy-yarn-install.yml

  docker-compose -f docker-compose-deploy-yarn-install.yml down && docker-compose -f docker-compose-deploy-yarn-install.yml up

  echo '\n\n\n\n🎉  All Dependencies Installation Completed!\n\n\n\n\n'
}

platform_vercel() {
  cp -fr ./tools/deploy-config/vercel/* ${__DEPLOY__}
  cd ${__DEPLOY__} || exit

  vercel --prod -c
}

platform_local_start() {
  cd ${__DEPLOY__} || exit

  yarn start
}

platform_docker_start() {
  cd ${__DEPLOY__} || exit

  yarn docker-start
}


# ------------------------------------------------------------------------

while getopts 'p:i?h' arg
do
  # shellcheck disable=SC2220
  case $arg in
    p) set_var PLATFORM "$OPTARG" ;;
    i) set_var YARN_BUILD ignore ;;
    h|?) usage ;;
    *) usage ;; esac
done


echo "\x1B[96m

   ___   ___  ____ ${PLATFORM}
  / _ | / _ \/  _/
 / __ |/ ___// /
/_/ |_/_/  /___/


\x1B[0m"


[ -z "$PLATFORM" ] && usage

CONFIRM_MESSAGE=$(printf "\n\n🤖 \033[1m Start Deploy <%s> ?\033[0m  (Enter/n)" "${PLATFORM}")
read -p "${CONFIRM_MESSAGE}" -n 1 -r KEY


if [ "$KEY" = "" ]; then
  # ---------
  # @ROOT-DIR
  # ---------
  if [ "$YARN_BUILD" != "ignore" ]; then
    yarn build
  fi

  #/
  if [ ! -d ${__DEPLOY__} ]; then
    mkdir -p ${__DEPLOY__}
  fi
  cp -fr ./_dist/* ${__DEPLOY__}
  cp -f ./tools/deploy-config/server/index.js ${__DEPLOY__}
  cp -f ./tools/deploy-config/server/package.json ${__DEPLOY__}
  cp -f ./.gitignore ${__DEPLOY__}

  #/assets (copy and then delete some gen files)
  if [ ! -d ${__DEPLOY__}/src/assets ]; then
    mkdir -p ${__DEPLOY__}/src/assets
  fi
  cp -fr ./src/assets/* ${__DEPLOY__}/src/assets

  #delete some gen files
  rm -f ./src/assets/dicts/*.dict.txt
  rm -f ./src/assets/divisions/*.division.json

  #public
  if [ ! -d ${__DEPLOY__}/public ]; then
    mkdir -p ${__DEPLOY__}/public
  fi
  cp -f ./public/robots.txt ${__DEPLOY__}/public
  cp -f ./public/favicon.ico ${__DEPLOY__}/public
  cp -f ./public/get-weixin-code.html ${__DEPLOY__}/public
  cp -f ./public/version.txt ${__DEPLOY__}/public


  # -----------
  # @DEPLOY-DIR
  # -----------
  if [ -n "$PLATFORM" ]; then
    case $PLATFORM in
      local_start) platform_local_start ;;
      docker_start) platform_docker_start ;;
      docker_install) platform_docker_install ;;
      vercel) platform_vercel ;;
      *) usage ;; esac
  fi

else
    # shellcheck disable=SC2028
    echo "\nCancel Deploy\n"
fi
