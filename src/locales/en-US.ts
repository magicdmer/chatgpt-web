export default {
  common: {
    add: 'Add',
    addSuccess: 'Add Success',
    edit: 'Edit',
    editSuccess: 'Edit Success',
    delete: 'Delete',
    deleteSuccess: 'Delete Success',
    save: 'Save',
    test: 'Test',
    saveSuccess: 'Save Success',
    reset: 'Reset',
    action: 'Action',
    export: 'Export',
    exportSuccess: 'Export Success',
    import: 'Import',
    importSuccess: 'Import Success',
    clear: 'Clear',
    clearSuccess: 'Clear Success',
    yes: 'Yes',
    no: 'No',
    confirm: 'Confirm',
    download: 'Download',
    noData: 'No Data',
    wrong: 'Something went wrong, please try again later.',
    success: 'Success',
    failed: 'Failed',
    register: 'Register',
    login: 'Login',
    notLoggedIn: 'Login / Register',
    logOut: 'Login Out',
    unauthorizedTips: 'Unauthorized, please verify first.',
    email: 'Email',
    password: 'Password',
    passwordConfirm: 'Confirm Password',
    resetPassword: 'Reset Password',
    resetPasswordMail: 'Send Reset Password Mail',
    auditTip: 'Sensitive words do not take effect on Admin.',
    block: 'block',
    unblock: 'unblock',
  },
  chat: {
    newChatButton: 'New Chat',
    placeholder: 'Ask me anything...(Shift + Enter = line break, "/" to trigger prompts)',
    placeholderMobile: 'Ask me anything...',
    copy: 'Copy',
    copied: 'Copied',
    copyCode: 'Copy Code',
    clearChat: 'Clear Chat',
    clearChatConfirm: 'Are you sure to clear this chat?',
    exportImage: 'Export Image',
    exportImageConfirm: 'Are you sure to export this chat to png?',
    exportSuccess: 'Export Success',
    exportFailed: 'Export Failed',
    usingContext: 'Context Mode',
    turnOnContext: 'In the current mode, sending messages will carry previous chat records.',
    turnOffContext: 'In the current mode, sending messages will not carry previous chat records.',
    deleteMessage: 'Delete Message',
    deleteMessageConfirm: 'Are you sure to delete this message?',
    deleteHistoryConfirm: 'Are you sure to clear this history?',
    clearHistoryConfirm: 'Are you sure to clear chat history?',
    preview: 'Preview',
    showRawText: 'Show as raw text',
    usageEstimate: 'Estimate',
    usagePrompt: 'Prompt',
    usageResponse: 'Response',
    usageTotal: 'Total token cost',
    deleteUser: 'Delete User',
    editUser: 'Edit User',
    deleteUserConfirm: 'Are you sure to delete this user? After deletion, this email can never be registered or logged in again.',
    blockUserConfirm: 'Are you sure to block this user? After block, this email can never be registered or logged in again.',
    verifiedUser: 'Verified User',
    deleteKey: 'Delete Key',
    editKeyButton: 'Edit Key',
    deleteKeyConfirm: 'Are you sure to delete this key?',
  },
  setting: {
    setting: 'Setting',
    general: 'General',
    advanced: 'Advanced',
    statistics: 'Statistics',
    config: 'Base Config',
    siteConfig: 'Site Config',
    mailConfig: 'Mail Config',
    auditConfig: 'Audit Config',
    avatarLink: 'Avatar Link',
    name: 'Name',
    description: 'Description',
    temperature: 'Temperature',
    top_p: 'Top_p',
    saveUserInfo: 'Save User Info',
    role: 'Role',
    chatHistory: 'ChatHistory',
    theme: 'Theme',
    language: 'Language',
    api: 'API',
    reverseProxy: 'Reverse Proxy',
    timeout: 'Timeout(ms)',
    socks: 'Socks',
    socksAuth: 'Socks Auth',
    httpsProxy: 'HTTPS Proxy',
    balance: 'API Balance',
    statisticsPeriod: 'Statistics Period',
    statisticsPeriodLastMonth: 'Last Month',
    statisticsPeriodCurrentMonth: 'Current Month',
    statisticsPeriodLast30Days: 'Last 30 Days',
    statisticsPrompt: 'Prompt',
    statisticsCompletion: 'Response',
    statisticsTotal: 'Total',
    smtpHost: 'Host',
    smtpPort: 'Port',
    smtpTsl: 'Tsl',
    smtpUserName: 'UserName',
    smtpPassword: 'Password',
    siteTitle: 'Title',
    siteDomain: 'Domain',
    registerEnabled: 'Register Enabled',
    registerReview: 'Register Review',
    registerMails: 'Register Mails',
    registerReviewTip: 'Only email addresses with these suffixes are allowed to register on this website.',
    apiBaseUrl: 'Api Base Url',
    apiModel: 'Api Model',
    accessToken: 'Access Token',
    loginEnabled: 'Login Enabled',
    loginSalt: 'Login Salt',
    loginSaltTip: 'Changes will invalidate all logged in',
    monthlyUsage: 'Monthly Usage',
    auditEnabled: 'Third Party',
    auditProvider: 'Provider',
    auditApiKey: 'Api Key',
    auditApiSecret: 'Api Secret',
    auditTest: 'Test Text',
    auditBaiduLabel: 'Label',
    auditBaiduLabelTip: 'English comma separated, If empty, only politics.',
    auditBaiduLabelLink: 'Goto Label Detail',
    auditCustomizeEnabled: 'Customize',
    auditCustomizeWords: 'Sensitive Words',
    accessTokenExpiredTime: 'Expired Time',
    userConfig: 'Users',
    keysConfig: 'Keys Manager',
    userRoles: 'User Role',
    status: 'Status',
    chatModels: 'Chat Models',
    remark: 'Remark',
    email: 'Email',
    password: 'Password',
  },
  store: {
    siderButton: 'Prompt Store',
    local: 'Local',
    online: 'Online',
    title: 'Title',
    description: 'Description',
    clearStoreConfirm: 'Whether to clear the data?',
    importPlaceholder: 'Please paste the JSON data here',
    addRepeatTitleTips: 'Title duplicate, please re-enter',
    addRepeatContentTips: 'Content duplicate: {msg}, please re-enter',
    editRepeatTitleTips: 'Title conflict, please revise',
    editRepeatContentTips: 'Content conflict {msg} , please re-modify',
    importError: 'Key value mismatch',
    importRepeatTitle: 'Title repeatedly skipped: {msg}',
    importRepeatContent: 'Content is repeatedly skipped: {msg}',
    onlineImportWarning: 'Note: Please check the JSON file source!',
    downloadError: 'Please check the network status and JSON file validity',
  },
}
