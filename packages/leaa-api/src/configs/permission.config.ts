import { shield, allow, rule } from 'graphql-shield';

import { authUtil } from '@leaa/common/utils';
import { envConfig } from '../modules/config/config.module';

const checkPermission = (permissionSlug: string) => {
  return rule()(async (parent, args, ctx) => authUtil.getFlatPermissions(ctx.user).includes(permissionSlug));
};

export const permissions = shield(
  {
    Query: {
      roles: checkPermission('user.edit'),
      role: checkPermission('user.edit'),
      //
      permissions: checkPermission('user.edit'),
      permission: checkPermission('user.edit'),
      //
      users: checkPermission('user.edit'),
      user: checkPermission('user.edit'),
    },
    Mutation: {
      login: allow,
      createUser: allow,
      updateUser: allow,
    },
  },
  {
    allowExternalErrors: envConfig.NODE_ENV !== 'production',
  },
);
