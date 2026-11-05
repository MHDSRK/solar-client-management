export type UserRole = "admin" | "manager" | "staff";

export const rolePermissions: Record<UserRole, Record<string, boolean>> = {
  admin: {
    viewCustomers: true,
    viewFinancials: true,
    createCustomers: true,
    editGeneralCustomerDetails: true,
    changeContractValue: true,
    managePlants: true,
    manageDocuments: true,
    createPayments: true,
    createExpenses: true,
    confirmPayments: true,
    voidPayments: true,
    confirmExpenses: true,
    voidExpenses: true,
    manageRateMaster: true,
    manageIntegrations: true,
    manageUsers: true,
    archiveCustomers: true,
    permanentDeletion: true,
  },
  manager: {
    viewCustomers: true,
    viewFinancials: true,
    createCustomers: true,
    editGeneralCustomerDetails: true,
    changeContractValue: true,
    managePlants: true,
    manageDocuments: true,
    createPayments: true,
    createExpenses: true,
    confirmPayments: true,
    voidPayments: false,
    confirmExpenses: true,
    voidExpenses: false,
    manageRateMaster: false,
    manageIntegrations: false,
    manageUsers: false,
    archiveCustomers: false,
    permanentDeletion: false,
  },
  staff: {
    viewCustomers: true,
    viewFinancials: true,
    createCustomers: true,
    editGeneralCustomerDetails: true,
    changeContractValue: false,
    managePlants: true,
    manageDocuments: true,
    createPayments: true,
    createExpenses: true,
    confirmPayments: false,
    voidPayments: false,
    confirmExpenses: false,
    voidExpenses: false,
    manageRateMaster: false,
    manageIntegrations: false,
    manageUsers: false,
    archiveCustomers: false,
    permanentDeletion: false,
  },
};

export function can(role: UserRole, action: string): boolean {
  return Boolean(rolePermissions[role]?.[action]);
}

export function requireReasonIfContractEdit(role: UserRole, isContractValueChange: boolean, reason?: string) {
  if (!isContractValueChange) {
    return true;
  }

  if (!can(role, "changeContractValue")) {
    return false;
  }

  return typeof reason === "string" && reason.trim().length > 0;
}
