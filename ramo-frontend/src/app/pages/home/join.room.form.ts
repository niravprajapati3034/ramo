import { FormBuilder, FormControl, FormGroup, Validators } from '@angular/forms';

export class IJoinRoomFormDto {
  nickname: string;
  roomCode: string;
}

export class JoinRoomFormDto implements IJoinRoomFormDto {
  nickname: string;
  roomCode: string;

  form: FormGroup;

  constructor(private _fb: FormBuilder) {}

  CreateForm() {
    this.form = this._fb.group(JoinRoomFormDto.getForm());
  }

  public static getForm() {
    return {
      nickname: new FormControl('', [Validators.required]),
      roomCode: new FormControl('', [Validators.required]),
    };
  }

  get(data: IJoinRoomFormDto) {
    this.nickname = data?.nickname;
    this.roomCode = data?.roomCode;

    this.CreateForm();
    this.form.patchValue(this);

    return this;
  }
}
