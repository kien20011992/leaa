import fs from 'fs';
import { Repository } from 'typeorm';
import { Injectable, HttpCode } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import axios from 'axios';
import crypto from 'crypto';
import moment from 'moment';
import request from 'request';
import OSS from 'ali-oss';

import {
  ISaveInOssSignature,
  ICraeteAttachmentByOssCallback,
  IAttachmentType,
  IAttachmentCreateFieldByOss,
} from '@leaa/common/src/interfaces';
import { ConfigService } from '@leaa/api/src/modules/v1/config/config.service';
import { Attachment } from '@leaa/common/src/entrys';
import { filenameAt1xToAt2x, isAt2x, logger, uuid } from '@leaa/api/src/utils';
import { attachmentConfig } from '@leaa/api/src/configs';
import mkdirp from 'mkdirp';
import { isUUID } from '@nestjs/common/utils/is-uuid';

const CLS_NAME = 'SaveInOssService';

@Injectable()
export class SaveInOssService {
  constructor(
    @InjectRepository(Attachment) private readonly attachmentRepo: Repository<Attachment>,
    private readonly configService: ConfigService,
  ) {}

  // eslint-disable-next-line max-len
  private uploadEndPoint = attachmentConfig.UPLOAD_ENDPOINT_BY_OSS;
  private EXPIRED_TIME_MINUTES = 10;

  client: OSS = new OSS({
    accessKeyId: this.configService.ATTACHMENT_OSS_ALIYUN_AK_ID,
    accessKeySecret: this.configService.ATTACHMENT_OSS_ALIYUN_AK_SECRET,
    region: this.configService.ATTACHMENT_OSS_ALIYUN_REGION,
    bucket: this.configService.ATTACHMENT_OSS_ALIYUN_BUCKET,
  });

  async getSignature(): Promise<ISaveInOssSignature> {
    // prettier-ignore
    const expiration = moment(Date.now()).add(this.EXPIRED_TIME_MINUTES, 'minutes').utc().format();

    const OSSAccessKeyId = this.configService.ATTACHMENT_OSS_ALIYUN_AK_ID;
    const OSSAccessKeySecret = this.configService.ATTACHMENT_OSS_ALIYUN_AK_SECRET;
    const saveDirPath = attachmentConfig.SAVE_DIR_BY_DB;

    const policyJson = JSON.stringify({
      expiration,
      conditions: [
        ['content-length-range', 0, this.configService.ATTACHMENT_LIMIT_SIZE_MB * 1024 * 1024],
        ['starts-with', '$key', saveDirPath],
      ],
    });

    const policy = Buffer.from(policyJson).toString('base64');
    const signature = crypto.createHmac('sha1', OSSAccessKeySecret).update(policy).digest('base64');

    /* eslint-disable no-template-curly-in-string */
    const callbackBody =
      '{' +
      '"object": ${object},' +
      '"bucket": ${bucket},' +
      '"size": ${size},' +
      '"etag": ${etag},' +
      '"height": ${imageInfo.height},' +
      '"width": ${imageInfo.width},' +
      '"mimeType": ${mimeType},' +
      '"format": ${imageInfo.format},' +
      //
      // self var, only use e.g. `var_id`, not `varId`
      '"originalname": ${x:originalname},' +
      '"type": ${x:type},' +
      '"moduleId": ${x:module_id},' +
      '"moduleName": ${x:module_name},' +
      '"typeName": ${x:type_name}' +
      '"typePlatform": ${x:type_platform}' +
      '}';
    /* eslint-enable no-template-curly-in-string */

    const callbackJson = {
      callbackUrl: this.configService.ATTACHMENT_OSS_ALIYUN_CALLBACK_URL,
      callbackBodyType: 'application/json', // cry... this `\/` wasting some time...
      callbackBody,
    };

    const callback = Buffer.from(JSON.stringify(callbackJson)).toString('base64');

    return {
      saveIn: 'oss',
      uploadEndPoint: this.uploadEndPoint,
      OSSAccessKeyId,
      policy,
      signature,
      expiration,
      saveDirPath,
      callback,
    };
  }

  async downloadFile(fileUrl: string, cb: (file: Buffer) => void) {
    console.log('downloadFile', fileUrl);
    const tempFile = `/tmp/${new Date().getTime()}`;
    let result = null;

    await axios({ url: fileUrl, responseType: 'stream' }).then(
      (response) =>
        new Promise((resolve, reject) => {
          response.data
            .pipe(fs.createWriteStream(tempFile))
            .on('finish', async () => {
              const file: Buffer = fs.readFileSync(tempFile);

              result = await cb(file);

              return resolve();
            })
            .on('error', (e: Error) => reject(e));
        }),
    );

    return result;
  }

  async saveAt2xToAt1xByOss(filename: string): Promise<OSS.PutObjectResult | null> {
    console.log('saveAt2xToAt1xByOss', filename);
    const at1xUrl = `${this.uploadEndPoint}/${filename}?x-oss-process=image/resize,p_50`;

    return this.downloadFile(at1xUrl, (file) => this.client.put(filename.replace('_2x', ''), file));
  }

  async saveOssToLocal(attachment: Attachment): Promise<'success' | Error> {
    console.log('saveOssToLocal', attachment);
    await this.downloadFile(attachment.url || '', (file) => {
      try {
        mkdirp.sync(attachmentConfig.SAVE_DIR_BY_DISK);

        fs.writeFileSync(`${attachmentConfig.SAVE_DIR_BY_DISK}/${attachment.filename}`, file);
      } catch (err) {
        logger.error(JSON.stringify(err), CLS_NAME);
        throw Error(err.message);
      }
    });

    if (attachment.at2x) {
      await this.downloadFile(attachment.urlAt2x || '', (file) => {
        try {
          fs.writeFileSync(`${attachmentConfig.SAVE_DIR_BY_DISK}/${filenameAt1xToAt2x(attachment.filename)}`, file);
        } catch (e) {
          throw Error(e.message);
        }
      });
    }

    return 'success';
  }

  async createAttachmentByOss(req: ICraeteAttachmentByOssCallback): Promise<Attachment | undefined> {
    console.log('createAttachmentByOss', req);
    const splitFilename = req.object.split('/').pop();

    if (!splitFilename) {
      const message = 'Not Found Filename';

      logger.warn(message, CLS_NAME);

      return;
    }

    const filename = splitFilename.replace('_2x', '');

    const isImage = req.mimeType ? req.mimeType.includes(IAttachmentType.IMAGE) : false;
    const at2x = isAt2x(req.object) ? 1 : 0;
    let width = 0;
    let height = 0;

    if (isImage) {
      const rawWidth = Number(req.width);
      const rawHeight = Number(req.height);

      width = rawWidth; // eslint-disable-line prefer-destructuring
      height = rawHeight; // eslint-disable-line prefer-destructuring

      if (at2x) {
        width = Math.round(rawWidth / 2);
        height = Math.round(rawHeight / 2);
      }
    }

    const filepath = `/${req.object.replace('_2x', '')}`;

    const ext = `.${req.format}`.toLowerCase();
    const title = req.originalname.replace(ext, '');
    const id = filename.replace(ext, '');

    if (isImage && at2x) {
      const at1x = await this.saveAt2xToAt1xByOss(req.object);

      if (!at1x) {
        const message = `Save @2x To @1x Failed, ${JSON.stringify(req.object)}`;

        logger.warn(message, CLS_NAME);

        return;
      }
    }

    const attachmentData: IAttachmentCreateFieldByOss = {
      id: isUUID(id) ? id : uuid(),
      title,
      alt: title,
      type: req.mimeType ? `${req.mimeType.split('/')[0]}` : 'no-mime',
      filename,
      // DB use snakeCase, e.g. module_abc --> moduleAbc
      module_name: req.moduleName,
      module_id: typeof req.moduleId !== 'undefined' ? req.moduleId : '0',
      type_name: req.typeName,
      type_platform: req.typePlatform,
      //
      ext,
      width,
      height,
      path: filepath,
      size: Number(req.size),
      at2x,
      sort: 0,
      in_oss: 1,
      in_local: 0,
    };

    // if SAVE_IN_LOCAL failed, don't write DB
    if (this.configService.ATTACHMENT_SAVE_IN_LOCAL) {
      const status = await this.saveOssToLocal(attachmentData as Attachment);

      if (status !== 'success') {
        throw Error('Save Oss To Local Error');
      }

      attachmentData.in_local = 1;
    }

    // eslint-disable-next-line consistent-return
    return this.attachmentRepo.save({ ...attachmentData });
  }

  @HttpCode(200)
  async ossCallback(req: ICraeteAttachmentByOssCallback): Promise<any> {
    console.log('-------- ATTACHMENT OSS CALLBACK --------\n', req);

    const attachment = await this.createAttachmentByOss(req);

    return {
      ...attachment,
      request,
      status: 'success',
    };
  }
}
