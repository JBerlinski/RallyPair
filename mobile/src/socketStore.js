// The driver's socket is opened on the pairing screen and used on the map screen.
// Sockets are not serialisable, so they cannot travel through navigation params.
let driverSocket = null;

export const socketStore = {
  setDriver(socket) { driverSocket = socket; },
  getDriver() { return driverSocket; },
  clearDriver() { driverSocket = null; },
};
