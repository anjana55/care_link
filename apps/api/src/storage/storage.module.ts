import { Global, Module } from '@nestjs/common';
import { STORAGE_SERVICE } from './storage.interface';
import { LocalFileStorageService } from './local-file-storage.service';

@Global()
@Module({
  providers: [
    {
      provide: STORAGE_SERVICE,
      useClass: LocalFileStorageService,
    },
  ],
  exports: [STORAGE_SERVICE],
})
export class StorageModule {}
