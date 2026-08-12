import { FormBuilder, FormControl, FormGroup, Validators } from '@angular/forms';

export class IAnswerFormDto {
  answer: string;
}

export class AnswerFormDto implements IAnswerFormDto {
  answer: string;

  form: FormGroup;

  constructor(private _fb: FormBuilder) {}

  CreateForm() {
    this.form = this._fb.group(AnswerFormDto.getForm());
  }

  public static getForm() {
    return {
      answer: new FormControl('', [Validators.required]),
    };
  }

  get(data: IAnswerFormDto) {
    this.answer = data?.answer;

    this.CreateForm();
    this.form.patchValue(this);

    return this;
  }
}
