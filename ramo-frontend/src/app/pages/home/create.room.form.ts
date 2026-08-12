import { FormBuilder, FormControl, FormGroup, Validators } from '@angular/forms';

export class ICreateRoomFormDto {
  nickname: string;
  theme: string;
}

export class CreateRoomFormDto implements ICreateRoomFormDto {
  nickname: string;
  theme: string;

  form: FormGroup;

  constructor(private _fb: FormBuilder) {}

  CreateForm() {
    this.form = this._fb.group(CreateRoomFormDto.getForm());
  }

  public static getForm() {
    return {
      nickname: new FormControl('', [Validators.required]),
      theme: new FormControl('', [Validators.required]),
    };
  }

  get(data: ICreateRoomFormDto) {
    this.nickname = data?.nickname;
    this.theme = data?.theme;

    this.CreateForm();
    this.form.patchValue(this);

    return this;
  }
}
