module.exports = {
  LibraryDirectoryPath: '/library', DocumentDirectoryPath: '/documents',
  exists: jest.fn().mockResolvedValue(false), stat: jest.fn(), readFile: jest.fn(), readDir: jest.fn().mockResolvedValue([]), uploadFiles: jest.fn(),
  mkdir: jest.fn().mockResolvedValue(undefined), unlink: jest.fn().mockResolvedValue(undefined),
  getFSInfo: jest.fn().mockResolvedValue({ freeSpace: 3000000000 }),
  downloadFile: jest.fn(), hash: jest.fn(), moveFile: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined),
};
