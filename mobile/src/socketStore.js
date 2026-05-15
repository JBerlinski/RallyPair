// Module-level singletons — avoids passing non-serializable socket objects through navigation params
let _driverSocket = null;
let _navigatorSocket = null;

export const socketStore = {
  setDriver(s) { _driverSocket = s; },
  getDriver() { return _driverSocket; },
  clearDriver() { _driverSocket = null; },

  setNavigator(s) { _navigatorSocket = s; },
  getNavigator() { return _navigatorSocket; },
  clearNavigator() { _navigatorSocket = null; },
};
